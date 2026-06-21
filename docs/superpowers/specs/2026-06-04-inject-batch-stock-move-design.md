# Inject 批量移仓 · 设计文档

> 日期: 2026-06-04 · 状态: 自动确认设计, 进入 writing-plans / 实现

## 目标

在 `Inject` 页面新增一个“批量移动藏品到其他物品箱”的桌面端功能。

用户可以：

- 拉取当前所有物品箱的详细藏品快照
- 选择一个来源物品箱
- 多选该物品箱里的藏品
- 选择一个目标物品箱
- 执行一轮批量搬运

本功能只面向“藏品”搬运，不处理普通仓库道具上架或交易所逻辑。

## 范围

- **v1 仅支持**: 单个来源物品箱 -> 单个目标物品箱
- **v1 支持批量**: 一次勾选多件藏品, 顺序执行多次单件移动
- **v1 保持朝向**: 默认保持藏品当前 `rotate` 状态, 不提供手动旋转切换
- **v1 自动排位**: 前端根据目标箱当前快照自动寻找第一个可放位置
- **v1 失败策略**:
  - 某件找不到可放位置: 记录为跳过, 继续尝试后续藏品
  - 某次实际 `MoveItem` 命令失败: 停止整轮批量操作并显示部分成功结果

## 非目标

- 不支持跨多个来源物品箱混选
- 不支持手动指定每件藏品的目标格位
- 不支持手动切换朝向再搬运
- 不支持柜子装备/卸下(`EquipStock` / `UnEquipStock`)
- 不支持堆叠/合并逻辑(`MergeItem`)
- 不支持“整理/Zhengli”或自动重排整个目标箱
- 不新增独立 Electron IPC 通道, 继续复用 `runAutoOperationCommand(command, args)`

## 已确认上下文

### 现有 Inject 页面

`src/inject/App.vue` 当前已经具备：

- AutoOperation Agent 加载/卸载
- `GetStockCollectibleCounts` 的聚合库存面板
- 手动 `ExchangeItem`
- 延迟价格查询
- 收藏价格扫描

它还没有：

- 物品箱级明细快照
- 来源/目标物品箱选择
- 多选藏品
- 批量移动进度与结果面板

### 现有桌面桥接

当前 renderer 已可直接调用：

- `window.bidkingDesktop.startAutoOperationAgent()`
- `window.bidkingDesktop.runAutoOperationCommand(command, args)`

因此这项功能**不需要新增 preload/main IPC 形状**, 只需要新增 Agent 命令, 再通过现有通用桥接透传。

### 现有游戏侧高层方法

仓库内保留的 `tmp/bidking-re/Scripts.dll` 反编译索引已确认 `PlayerManager` 暴露：

- `GetAllStocks() -> Task<List<Protodata.StockContainerData>>`
- `MoveItem(int32 oldStockId, int32 oldSlot, int32 newStockId, int32 newSlot, bool isRotate) -> Task<List<Protodata.StockContainerData>>`
- `EquipStock(...)`
- `UnEquipStock(...)`
- `MergeItem(...)`

同时 `GridItemData` 已确认含有：

- `itemId`
- `pos`
- `rotate`
- `stockId`
- `count`

这说明 Agent 不需要手搓底层 protobuf 的 `C2S12MoveItem`; 可以直接走游戏现有高层 `PlayerManager.MoveItem(...)`。

## 方案比较

### A. 推荐方案: 新增“详细快照 + 单件移动”命令, renderer 顺序执行批量

新增两个 Agent 命令：

- `GetStockContainers`
- `MoveStockItem`

其中：

- `GetStockContainers` 返回可供 UI 消费的详细物品箱快照
- `MoveStockItem` 执行单件搬运, 并返回搬运后的最新物品箱快照
- renderer 在一轮批量操作中顺序调用多次 `MoveStockItem`, 以最新快照计算下一件的目标位置

优点：

- 命令语义清晰
- 失败边界清楚, 易展示部分成功结果
- 复用现有通用 IPC, diff 可控
- 目标箱占位计算可以放在纯 JS helper 中做 UT
- 每次移动后都拿到最新快照, 不会长时间使用陈旧状态

缺点：

- 一轮批量操作会有多次 pipe 往返
- renderer 需要承担目标位扫描逻辑

### B. Agent 端直接做“一次性批量搬运”

新增一个 `MoveStockItemsBatch` 命令, 由 C++ Agent 负责目标位计算、循环搬运、汇总结果。

优点：

- renderer 更薄
- 单次命令完成整轮操作

缺点：

- C++ 侧复杂度明显更高
- 目标位算法和错误展示更难调试
- 单测和回归成本更高

### C. 复用 `InvokeMethod` / 调试命令拼装参数

不新增 Agent 命令, 让前端直接通过 `InvokeMethod` 或现有调试命令把调用串起来。

优点：

- 理论上改动少

缺点：

- 当前 `InvokeMethod` 只支持 0 参或 1 个 `arg0`
- 无法承载 `oldStockId/oldSlot/newStockId/newSlot/isRotate`
- 没有稳定返回契约

### 结论

采用 **A**。

## 架构

### 1. Agent: 详细物品箱快照

新增 `GetStockContainers` 命令。

命令入口仍先调用 `PlayerManager.GetAllStocks()` 刷新游戏侧库存数据, 但序列化时优先读取游戏内已经整理好的 `PlayerGameData.wareHouses -> WareHouseData.gridItemDatas` 视图, 避免把每个 `stockBoxes.position` 原样展开导致 pipe payload 过大。

返回结构应至少包含：

```json
{
  "containers": [
    {
      "stockId": 1,
      "stockCid": 1001,
      "width": 10,
      "height": 14,
      "boxCount": 140,
      "items": [
        {
          "itemUid": "1295018822725931",
          "itemCid": 1032006,
          "count": 1,
          "pos": 24,
          "rotate": false,
          "stockId": 1,
          "boxCount": 4,
          "boxIds": [24, 25, 34, 35],
          "canTrade": true,
          "isLock": false
        }
      ]
    }
  ],
  "count": 10,
  "source": "PlayerManager.GetAllStocks"
}
```

设计要求：

- 以“每件藏品”为单位输出, 不是 CID 聚合
- `pos` 作为后续 `oldSlot` 的直接来源
- `rotate` 原样带出
- `boxIds` 供 renderer 做占位与目标位扫描
- `width/height` 直接读取 `WareHouseData.width/height`
- `boxCount = width * height`
- 结果必须避免把每个格子的 `x/y` 明细全量展开, 以控制在 `BK_BUF_SIZE` 内

### 2. Agent: 单件搬运命令

新增 `MoveStockItem` 命令。

请求参数：

```json
{
  "oldStockId": 1,
  "oldSlot": 24,
  "newStockId": 2,
  "newSlot": 11,
  "isRotate": false
}
```

Agent 直接调用：

```text
PlayerManager.MoveItem(oldStockId, oldSlot, newStockId, newSlot, isRotate)
```

成功返回：

```json
{
  "moved": true,
  "oldStockId": 1,
  "oldSlot": 24,
  "newStockId": 2,
  "newSlot": 11,
  "isRotate": false,
  "containers": [ ...latest snapshot... ],
  "source": "PlayerManager.MoveItem"
}
```

失败返回：

- 参数非法
- `MoveItem` task 超时/取消/faulted
- 返回 `null`

### 3. Renderer: 纯 JS 目标位扫描 helper

新增 `src/inject/stock-move.js` 纯函数模块。

职责：

- 规范化 `GetStockContainers` 返回
- 按 `boxCount DESC, pos ASC` 排序待搬运藏品, 优先放大件
- 基于目标箱 `width/height` 与所有 item 的 `boxIds` 计算“第一个可放位置”
- 产出 `MoveStockItem` 需要的 `{ oldStockId, oldSlot, newStockId, newSlot, isRotate }`

扫描规则：

- 保持原朝向, 不尝试旋转
- 以目标箱线性槽位的 row-major 顺序扫描
- 一旦找到完整空位即返回
- 若找不到位置, 标记该藏品为 `no_space`

实现上:

- 源 item 的 shape 优先由自身 `boxIds + pos + target.width` 归一化得到
- 目标占位直接由所有 item 的 `boxIds` 合并得到
- 若某个 item 没有可用 `boxIds`, 则该 item 在 v1 中不可参与批量移动

### 4. Renderer: Inject 页面 UI

不把新逻辑继续堆进 `src/inject/App.vue` 主体。

新增 `src/inject/StockMovePanel.vue`, 由 `App.vue` 挂载。

UI 最小形态：

- 顶部按钮: `加载物品箱`
- 来源物品箱下拉
- 目标物品箱下拉
- 当前来源箱藏品表格
  - checkbox
  - 名称
  - 品质
  - 类型
  - 尺寸
  - 当前位置(`pos`)
  - 占用格数
- `全选` / `清空`
- `批量移动` 按钮
- 进度摘要:
  - 总数
  - 已成功
  - 跳过(无空间)
  - 停止原因

### 5. 状态更新

一次批量操作流程：

1. `GetStockContainers`
2. 用户选择来源箱 / 目标箱 / 多件藏品
3. 前端按排序规则逐件处理
4. 每一件:
   - 用当前快照找 `newSlot`
   - 调 `MoveStockItem`
   - 成功后用返回的新快照替换本地状态
5. 结束后保留结果摘要, 并让来源/目标箱表格显示最新状态

## 交互细节

- 仅桌面端 + Agent 可用时显示面板
- 来源箱与目标箱必须不同
- 未加载快照时按钮禁用
- 目标箱没有空位时, 当前件记为“跳过: 无可放位置”
- 若某次 `MoveStockItem` 真正失败, 停止整轮并显示“部分成功”
- 保留最后一次完整快照, 不因单次失败清空 UI

## 错误处理

- `GetStockContainers` 失败: 面板显示错误, 不清空上一次成功快照
- `MoveStockItem` 参数非法: 视为实现错误, 直接显示失败
- `MoveStockItem` task 超时/faulted: 停止批量, 保留已完成结果
- 某件在目标箱无空间: 记录为 skip, 继续后续藏品
- `collectibles.json` 中不存在该 `itemCid`: 行仍可显示 CID, 但名称/品质/类型为空, 允许继续移动

## 测试策略

### 纯逻辑

`src/inject/stock-move.test.js`

覆盖：

- 目标箱 first-fit 扫描
- 保持朝向
- 大件优先排序
- 无空间返回 `null`
- 仅从来源箱的可选项中生成 move args

### Agent / Node

`electron/services/inject-service.test.mjs`

覆盖：

- `GetStockContainers` 使用长超时
- `MoveStockItem` 使用长超时
- 通用命令桥可透传新增命令

`tools/inject/AutoOperation/BKAutoOpAgent` 本轮以命令实现为主, 若已有可承接的 C++ 单测入口, 补最小 serialization/helper 测试；若当前工程不便于稳定单测, 则至少通过 renderer/service UT 锁命令契约。

### Renderer

`src/inject/StockMovePanel.test.js`

覆盖：

- 加载快照后展示来源/目标箱
- 选择来源箱后展示藏品列表
- 勾选多件后调用多次 `MoveStockItem`
- 某件无空间时记 skip
- `MoveStockItem` 中途失败时停止批量并显示部分成功

`src/inject/App.test.js`

覆盖：

- 桌面端显示新面板
- 非桌面端隐藏新面板

## 文档变更

实现同轮更新：

- `docs/AUTO_OPERATION_COMMANDS.md`
- `docs/Documentation.md`
- `docs/ARCHITECTURE.md`

其中 `AUTO_OPERATION_COMMANDS.md` 需补充：

- `GetStockContainers`
- `MoveStockItem`
- 当前命令总表中遗漏的 `GetWarehouseItemList` / `GetStockCollectibleCounts`
