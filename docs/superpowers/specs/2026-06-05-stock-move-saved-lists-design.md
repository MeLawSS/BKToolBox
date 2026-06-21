# Batch Stock Move Saved Lists Design

## Summary

为 Inject 页的 `Batch Stock Move` 增加“保存选中藏品列表”和“一键应用已保存列表”能力。

本功能面向“同类藏品批量移仓”场景，保存语义固定为 `itemCid` 集合，而不是具体实例 `itemUid`。应用列表时，如果当前源仓缺少列表中的部分藏品，则只选中当前源仓里实际存在的那部分，不报错、不阻断批量移仓主流程。

## Goals

- 支持将当前已选中的批量移仓藏品分组保存为命名列表。
- 列表持久化到 `Documents/BidKing` 下的专用目录，便于备份和跨会话复用。
- 支持在当前源仓一键应用某个已保存列表。
- 应用时仅依赖当前源仓中存在的 `itemCid`，允许部分命中。
- 保持现有批量移仓执行链路不变，只扩展“选择哪些藏品种类”这一步。

## Non-Goals

- 本轮不支持删除、重命名、导入、导出已保存列表。
- 本轮不支持按具体实例 `itemUid` 保存。
- 本轮不改变 `MoveStockItem` 的执行协议、节流逻辑或刷新逻辑。
- 本轮不新增云同步、账号绑定或跨设备协同。

## Existing Context

- 批量移仓 UI 与状态位于 `src/inject/StockMovePanel.vue`。
- 当前选择模型是 `selectedItemCids`，选择粒度已经是“按 `itemCid` 分组”。
- 批量移仓源列表来自 `sourceGroups`，天然适配保存 `itemCid` 集合。
- Electron 侧已有 `Documents/BidKing` 持久化模式，见 `electron/services/inject-service.js` 中其它 JSON 文件读写函数。
- Desktop bridge 通过 `electron/preload.js` 暴露 `window.bidkingDesktop` API，并由 `electron/main.js` 注册 `inject:*` IPC。

## Chosen Approach

采用方案 A：每个列表一个 JSON 文件，保存到 `Documents/BidKing/stock-move-lists/`。

选择原因：

- 与现有 `selectedItemCids` 模型完全一致，渲染层无需引入实例级选择。
- 单个文件损坏不会拖垮全部列表。
- 用户可直接备份或检查单个列表文件。
- Electron 侧职责清晰，便于后续按文件继续扩展删除、重命名等管理动作。

## Storage Design

### Directory

固定目录：

`Documents/BidKing/stock-move-lists/`

目录不存在时由 Electron 侧自动创建。

### File Model

每个列表一个 JSON 文件。文件名使用时间戳与随机短 ID 组合，避免同名覆盖：

`20260605153012-ab12cd.json`

文件内容结构：

```json
{
  "id": "20260605153012-ab12cd",
  "name": "主仓高频车件",
  "savedAt": "2026-06-05T15:30:12.000Z",
  "itemCids": [1083009, 1032006],
  "items": [
    {
      "itemCid": 1083009,
      "name": "Intake Manifold",
      "quality": "blue",
      "type": "vehicle",
      "sizeKey": "1x2"
    },
    {
      "itemCid": 1032006,
      "name": "Boots",
      "quality": "green",
      "type": "fashion",
      "sizeKey": "2x2"
    }
  ]
}
```

字段约束：

- `id`: 字符串，文件内外一致。
- `name`: 用户输入的展示名称，去除首尾空白后保存。
- `savedAt`: ISO 时间字符串，用于排序和展示。
- `itemCids`: 唯一化后的正整数数组，是唯一参与应用逻辑的字段。
- `items`: 保存时的展示快照，仅供 UI 显示与调试，不参与应用判定。

## IPC And Desktop Bridge

新增两个 IPC：

- `inject:listStockMoveLists`
- `inject:saveStockMoveList`

对应 bridge API：

- `window.bidkingDesktop.listStockMoveLists()`
- `window.bidkingDesktop.saveStockMoveList(payload)`

### listStockMoveLists

返回所有可解析列表，按 `savedAt` 倒序排序。

如果目录中存在损坏 JSON：

- 跳过该文件
- 不抛出整体失败
- 控制台可记录警告，但不影响用户加载其它列表

### saveStockMoveList

输入：

```json
{
  "name": "主仓高频车件",
  "itemCids": [1083009, 1032006],
  "items": [
    {
      "itemCid": 1083009,
      "name": "Intake Manifold",
      "quality": "blue",
      "type": "vehicle",
      "sizeKey": "1x2"
    }
  ]
}
```

校验：

- `name` 去空白后不能为空
- `itemCids` 至少包含一个有效正整数
- 重复 `itemCid` 在保存前去重

返回值：

- 成功时返回新保存的列表对象
- 失败时抛出明确错误消息，供渲染层展示

## Renderer Behavior

### UI Placement

在 `src/inject/StockMovePanel.vue` 中，围绕“当前选择的源仓藏品”区域新增“Saved Lists”区块，包含：

- 列表名称输入框
- `Save Current Selection` 按钮
- 已保存列表表格或列表视图
- 每条记录的 `Apply` 按钮

### List Row Content

每条已保存列表展示：

- 列表名称
- 保存时的种类数，即 `itemCids.length`
- 当前源仓匹配数，即 `itemCids` 与 `sourceGroups.itemCid` 的交集数量
- 保存时间
- `Apply` 操作按钮

### Apply Rules

点击 `Apply` 时：

1. 读取该列表的 `itemCids`
2. 取当前 `sourceGroups` 中存在的 `itemCid`
3. 将交集写回 `selectedItemCids`
4. 若交集为空，显示明确提示
5. 若部分命中，则直接应用命中的部分，不提示错误

应用动作只改变前端选择状态，不触发移仓命令，也不刷新仓库数据。

### Save Rules

点击 `Save Current Selection` 时：

1. 从当前 `selectedItemCids` 生成唯一化后的 `itemCids`
2. 从当前 `sourceGroups` 生成 `items` 快照
3. 调用 `saveStockMoveList`
4. 保存成功后立即重新拉取 `listStockMoveLists`
5. 保留当前选择，不改变已选分组

### Empty And Disabled States

- 非桌面环境下沿用现有降级逻辑，不展示可执行保存/加载动作。
- 未选择任何源仓时，已保存列表仍可展示，但匹配数显示为 `0`。
- `selectedItemCids` 为空时，保存按钮禁用。
- 名称输入为空白时，保存按钮禁用。

## Error Handling

- 读取列表失败：在 Saved Lists 区块显示错误消息，不影响批量移仓已有功能。
- 保存失败：显示错误消息，并保留用户输入名称与当前选择。
- 某个列表文件损坏：跳过该文件，不让整批列表加载失败。
- 当前源仓未命中任何已保存 `itemCid`：显示“当前源仓没有匹配藏品”类消息。

## Testing Strategy

### Electron Tests

扩展 `electron/services/inject-service.test.mjs`：

- 保存列表到临时 `Documents/BidKing/stock-move-lists`
- 列出多个列表时按 `savedAt` 倒序返回
- 忽略损坏 JSON 文件，仍返回有效列表
- 输入空名称或空 `itemCids` 时抛错

### Renderer Tests

扩展 `src/inject/StockMovePanel.test.js`：

- 保存当前选择时调用 `saveStockMoveList`
- 保存成功后刷新已保存列表展示
- 应用列表时只选中当前源仓存在的 `itemCid`
- 列表完全无命中时显示错误提示
- 显示当前匹配数而不是仅显示保存时总数

## Acceptance Criteria

- 用户可以在 Batch Stock Move 中输入名称并保存当前选中的 `itemCid` 列表。
- 列表文件落到 `Documents/BidKing/stock-move-lists/`。
- 重开应用后仍能读取并展示已保存列表。
- 点击 `Apply` 后，当前源仓中存在的目标种类会被立即选中。
- 若列表中部分种类当前不存在，只应用存在的部分。
- 若列表中所有种类当前都不存在，UI 给出明确提示。
- 现有批量移仓、进度显示、搜索和排序行为不回归。

## Implementation Notes

- 优先复用现有 `window.bidkingDesktop` 约定，不引入新的渲染层存储通道。
- 继续让 Electron 侧承担文件系统访问职责；Vue 渲染层不直接碰文件系统。
- 当前 `StockMovePanel.vue` 已较大，本轮只做与 Saved Lists 直接相关的抽取；不做无关拆分。
