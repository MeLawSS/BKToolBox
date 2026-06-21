# Batch Stock Move Full-Collectibles List Editor Design

## Summary

在现有 `Inject > Batch Stock Move > Saved Lists` 基础上，新增一个独立的“新建列表”弹窗，让用户可以从全量 `collectibles.json` 中搜索并选择藏品来创建列表，而不再受当前源仓 `sourceGroups` 的限制。

这个变更只改变“如何创建列表”，不改变“如何应用列表”：

- 创建时可以包含当前源仓里不存在的 `itemCid`
- 应用时仍然只勾选当前源仓实际存在的 `itemCid`
- 完全无命中时仍显示 inline error

## Goals

- 支持从全量藏品数据创建 Saved List，而不局限于当前源仓已有藏品。
- 把“创建列表”和“应用列表”在交互上分离，降低主面板复杂度。
- 保留快速把当前仓库勾选项导入到新列表草稿中的能力。
- 继续复用现有 `Documents/BidKing/stock-move-lists/` 持久化结构。

## Non-Goals

- 本轮不支持编辑已有列表。
- 本轮不支持删除、重命名、导入、导出列表。
- 本轮不改变列表文件结构；仍使用 `{ id, name, savedAt, itemCids, items }`。
- 本轮不改变 Apply 语义；仍只命中当前源仓存在的 `itemCid`。

## Existing Context

- 当前 `Saved Lists` 已经支持：
  - 持久化到 `Documents/BidKing/stock-move-lists/`
  - 主界面展示列表并 `Apply`
  - 保存时写入 `itemCids + items` 展示快照
  - 只对当前源仓实际存在的 `itemCid` 应用
- 当前创建入口还耦合在 `src/inject/StockMovePanel.vue` 中，保存来源仍依赖当前源仓的 `selectedItemCids + sourceGroups`。
- `StockMovePanel` 已经持有全量 `collectibles`，可以直接作为新建列表弹窗的数据源，无需新增服务端接口。

## Chosen Approach

采用独立弹窗方案。

### Why This Approach

- “创建列表”需要面向全量藏品，而“应用列表”仍是当前源仓语义，这两套交互放在同一块主面板里会持续变乱。
- 弹窗可以把搜索、草稿编辑、保存提交封装成单独组件，避免 `StockMovePanel.vue` 继续膨胀。
- 后续如果要增加“编辑已有列表 / 删除列表”，可以沿用同一个 modal editor 边界。

## UI Architecture

### Main Panel

`src/inject/StockMovePanel.vue` 继续负责：

- Batch Stock Move 主流程
- 已保存列表展示
- Apply 现有列表
- 打开 / 关闭新建列表弹窗
- 在保存成功后刷新 `savedLists`

主面板不再承担“从全量藏品里搜索并拼草稿”的职责。

### New Modal

新增 `src/inject/StockMoveListEditorModal.vue`，只负责：

- 列表名称输入
- 全量藏品搜索
- 把搜索结果加入草稿
- 从当前源仓已勾选项导入草稿
- 草稿项移除
- 保存草稿到现有 desktop save API

### Optional Helper

如有必要，新增纯函数 helper：

- `src/inject/stock-move-saved-list-draft.js`

职责限定为：

- 草稿去重
- 搜索过滤
- 从 `collectibles` 生成保存用 `items` 快照

如果实现中发现 `StockMoveListEditorModal.vue` 能保持清晰，则本轮可以不拆 helper。

## Modal Interaction

### Layout

弹窗按三段布局：

1. 顶部
   - 列表名称输入框
   - `导入当前仓库已勾选项` 按钮

2. 中部左侧
   - 全量藏品搜索框
   - 搜索结果列表
   - 每行显示：名称 / 品质 / 类型 / CID / 尺寸
   - 每行 `加入` 按钮

3. 中部右侧
   - 当前草稿列表
   - 每行显示同样的基础信息
   - 每行 `移除` 按钮

4. 底部
   - `取消`
   - `保存列表`

### Draft Rules

- 草稿按 `itemCid` 去重。
- 重复加入同一个 `itemCid` 时，不重复添加。
- “导入当前仓库已勾选项”只做并集，不清空已有草稿。
- 草稿项可以来自：
  - 当前源仓勾选项
  - 全量 `collectibles` 搜索结果

### Search Rules

- 搜索数据源固定为 `props.collectibles`
- 不依赖当前源仓
- 搜索键至少包含：
  - 名称
  - `itemCid`
  - 品质
  - 类型

### Save Rules

保存按钮仅在以下条件同时满足时可用：

- 名称非空
- 草稿至少包含一个 `itemCid`
- 当前不在保存中

保存时仍然调用现有：

```js
window.bidkingDesktop.saveStockMoveList({
  name,
  itemCids,
  items,
})
```

其中 `items` 继续使用展示快照结构：

```json
{
  "itemCid": 1083009,
  "name": "Intake Manifold",
  "quality": "blue",
  "type": "vehicle",
  "sizeKey": "1x2"
}
```

保存成功后：

- 关闭弹窗
- 主面板刷新 `savedLists`

## Main Panel Changes

`Saved Lists` 主区块改为：

- `新建列表` 按钮
- 已保存列表列表
- `Apply` 入口保持不变

主面板不再展示“列表名称输入框 + 直接保存当前选择”的旧交互。

### Apply Behavior

Apply 逻辑保持不变：

1. 读取 saved list 的 `itemCids`
2. 与当前 `sourceGroups` 做交集
3. 只勾选当前源仓实际存在的 `itemCid`
4. 若完全无命中，则显示 inline error

## Error Handling

### Modal

- 名称为空：保存按钮禁用
- 草稿为空：保存按钮禁用
- 保存 API 返回失败：在 modal 内显示错误，不关闭弹窗

### Main Panel

- Apply 完全无命中：沿用当前 inline error 模式
- 刷新 saved lists 失败：沿用当前主面板 savedLists error 显示

## Testing Strategy

### `src/inject/StockMoveListEditorModal.test.js`

覆盖：

- 全量搜索能命中当前源仓不存在的藏品
- 点击 `加入` 后进入草稿
- 重复加入不重复
- 点击 `导入当前仓库已勾选项` 会并入草稿
- 点击 `移除` 能移出草稿
- 保存时调用 `saveStockMoveList`，payload 中 `itemCids + items` 正确

### `src/inject/StockMovePanel.test.js`

覆盖：

- 主面板能打开 / 关闭 modal
- modal 保存成功后主面板刷新 `savedLists`
- 现有 Apply 逻辑不回归

### Optional Helper Tests

如果引入 `stock-move-saved-list-draft.js`，补纯函数测试覆盖：

- 去重
- 搜索过滤
- 快照生成

## Acceptance Criteria

- 用户可以打开一个独立弹窗，从全量 `collectibles.json` 搜索藏品来创建列表。
- 用户可以把当前源仓已勾选项导入该弹窗草稿。
- 草稿支持增删，并按 `itemCid` 去重。
- 保存后仍写入现有 saved-list 文件结构。
- 主面板继续展示已保存列表，并支持 Apply。
- Apply 到当前源仓时，仍只勾选当前实际存在的 `itemCid`。
- 已存在的 Batch Stock Move 搜索、排序、执行摘要和移动逻辑不回归。

## Implementation Notes

- 这次变更主要是 renderer/UI 侧重构，Electron 持久化层原则上不需要调整。
- `StockMovePanel.vue` 已经较大；本轮优先通过新增 modal 组件来隔离复杂度，而不是继续向主面板堆交互。
- 如果 modal 内部状态开始变杂，优先抽 draft helper，而不是把逻辑塞回主面板。
