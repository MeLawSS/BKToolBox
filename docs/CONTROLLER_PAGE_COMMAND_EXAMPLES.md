# Controller 页面命令示例

Overview manual: [`docs/AUTO_OPERATION_MANUAL.md`](./AUTO_OPERATION_MANUAL.md). Use the manual first for the current stack map and command-surface differences. This file stays focused on examples you can paste into `Inject -> Controller`.

本文档面向 `Inject -> Controller` 页面，提供当前可直接发送的命令示例。

它和 [`docs/AUTO_OPERATION_COMMANDS.md`](./AUTO_OPERATION_COMMANDS.md) 的分工是：

- 本文档：偏使用手册，给出可直接粘贴到 Controller 页的命令名和 JSON 参数示例
- `AUTO_OPERATION_COMMANDS.md`：偏协议手册，记录完整请求/响应约束、错误语义和底层实现说明

## 使用方式

Controller 页面当前直接复用：

```js
window.bidkingDesktop.runAutoOperationCommand(command, args)
```

因此页面里要填写的是：

- `命令名` 输入框：只填命令名，例如 `DumpPanelTree`
- `JSON 参数` 输入框：只填 `args` 对象，例如 `{ "panel": "UIMain" }`

不要在 Controller 页面里再手写外层信封：

```json
{
  "id": "1",
  "cmd": "DumpPanelTree",
  "args": {
    "panel": "UIMain"
  }
}
```

## 前置条件

- 当前必须运行在桌面端
- `Agent bridge` 必须可用
- `Agent` 必须已连接

如果 `Controller` 面板里的 `发送` 按钮是灰的，先到顶栏或 `Agent 状态` 面板启动 Agent。

## 响应怎么看

Controller 页当前展示的是 Electron bridge 的返回值，不只是 pipe 原始 `result`。

成功时通常会看到：

```json
{
  "ok": true,
  "value": {
    "...": "..."
  },
  "response": {
    "id": "123",
    "ok": true,
    "result": {
      "...": "..."
    }
  }
}
```

日常使用时，优先看：

- `ok`
- `value`

## 命令示例

下面所有示例都按 Controller 页的实际输入方式来写。

对 `DumpPanelTree` / `ClickNode` / `SetInputText` / `GetNodeState` / `WaitForNode` 这类 UI 自动化命令：

- 先用 `GetVisiblePanels` 确认当前顶层 `panel`
- 再用 `DumpPanelTree` 确认 `rootPath` 和 `path`
- 不要假设某个路径在所有场景下都始终存在

### Ping

用途：检查 Agent 是否在线。

命令名：

```text
Ping
```

JSON 参数：

```json
{}
```

关注返回：

- `value.pong === true`

### GetCurrentUI

用途：读取当前主界面 panel 类名。

命令名：

```text
GetCurrentUI
```

JSON 参数：

```json
{}
```

关注返回：

- `value.panel`

### GetVisiblePanels

用途：读取当前可见的顶层 panel 列表。

命令名：

```text
GetVisiblePanels
```

JSON 参数：

```json
{}
```

关注返回：

- `value.panels`

### OpenPanel

用途：打开已知 panel。

命令名：

```text
OpenPanel
```

JSON 参数：

```json
{
  "name": "UIMain"
}
```

也可以改成其他已知 panel，例如：

```json
{
  "name": "TradingExchange_Main"
}
```

关注返回：

- `value.opened === true`

### ClosePanel

用途：关闭当前 panel。

命令名：

```text
ClosePanel
```

JSON 参数：

```json
{}
```

说明：

- 它调用的是异步关闭逻辑
- 关闭后如果要继续编排，建议接 `WaitForVisiblePanel`

### DumpPanelTree

用途：导出某个 panel 或子树下的节点快照，常用于先找路径。

命令名：

```text
DumpPanelTree
```

JSON 参数，导出整个 `UIMain` 根下的交互节点：

```json
{
  "panel": "UIMain"
}
```

JSON 参数，导出某个子树：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/WareHouse",
  "maxDepth": 4,
  "nodeLimit": 200,
  "interactiveOnly": true,
  "includeInactive": false
}
```

关注返回：

- `value.panel`
- `value.rootPath`
- `value.nodes`
- `value.truncated`

说明：

- `nodes[].path` 总是相对于当前锚点返回
- 如果传了 `rootPath`，后续可以直接复用同一组 `panel + rootPath + path`

### ClickNode

用途：按路径点击某个按钮或切换控件。

命令名：

```text
ClickNode
```

JSON 参数，精确点击：

```json
{
  "panel": "UIMain",
  "path": "MainPanel/mask/Button"
}
```

JSON 参数，带 `rootPath` 点击：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/WareHouse",
  "path": "Down/saleTog",
  "pathMode": "exact",
  "component": "toggle"
}
```

JSON 参数，使用 `glob` 匹配动态节点：

```json
{
  "panel": "BattlePrevPanel_Main",
  "path": "Panel_1/bg/MapContainer/MapItem_*/Image (1)",
  "pathMode": "glob"
}
```

关注返回：

- `value.clicked`
- `value.resolvedPath`
- `value.component`

说明：

- `component` 可用值：`auto`、`button`、`toggle`
- `auto` 当前会优先尝试 `button`，其次 `toggle`

### SetInputText

用途：给 `TMP_InputField` 或 `NumericInputField` 写文本。

命令名：

```text
SetInputText
```

JSON 参数，写价格并触发提交事件：

```json
{
  "panel": "BidPop_Main",
  "path": "Panel/InputField",
  "text": "45000",
  "submit": true
}
```

JSON 参数，带 `rootPath` 写输入框：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/StorePanel_InfoPane",
  "path": "InputRoot/PriceInput",
  "text": "7799",
  "pathMode": "exact",
  "submit": false
}
```

关注返回：

- `value.updated`
- `value.resolvedPath`
- `value.component`
- `value.text`

说明：

- `text` 当前不能包含换行
- `text` 当前不能包含双引号

### GetNodeState

用途：读取节点文本、激活态、交互态、toggle 选中态。

命令名：

```text
GetNodeState
```

JSON 参数：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/StorePanel_InfoPane",
  "path": "InputRoot/PriceInput"
}
```

关注返回：

- `value.resolvedPath`
- `value.active`
- `value.interactive`
- `value.text`
- `value.toggleOn`

### WaitForVisiblePanel

用途：等待顶层 panel 出现或消失。

命令名：

```text
WaitForVisiblePanel
```

JSON 参数，等待 `BattlePrevPanel_Main` 出现：

```json
{
  "panel": "BattlePrevPanel_Main",
  "visible": true,
  "timeoutMs": 3000,
  "pollIntervalMs": 50
}
```

JSON 参数，等待某个弹窗关闭：

```json
{
  "panel": "BidPop_Main",
  "visible": false,
  "timeoutMs": 3000,
  "pollIntervalMs": 50
}
```

关注返回：

- `value.panel`
- `value.visible`
- `value.waitMs`

说明：

- `timeoutMs` 默认 `3000`
- `pollIntervalMs` 默认 `50`
- 允许范围见 `docs/AUTO_OPERATION_COMMANDS.md`

### WaitForNode

用途：等待节点出现并满足 `exists / active / interactive`。

命令名：

```text
WaitForNode
```

JSON 参数，等待出价确认按钮变为 active：

```json
{
  "panel": "Battle_Main",
  "path": "InputDevice/Panel1/chujia",
  "pathMode": "exact",
  "state": "active",
  "timeoutMs": 3000,
  "pollIntervalMs": 50
}
```

JSON 参数，等待某个子树下节点可交互：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/WareHouse",
  "path": "PanelWareHouseSale/Right/Button",
  "pathMode": "exact",
  "state": "interactive",
  "timeoutMs": 3000,
  "pollIntervalMs": 50
}
```

关注返回：

- `value.resolvedPath`
- `value.state`
- `value.waitMs`

### CollectionPrices

用途：运行 Agent 侧收藏价格查询。

命令名：

```text
CollectionPrices
```

JSON 参数：

```json
{}
```

关注返回：

- `value.items`

说明：

- 这是旧的 Agent 侧价格查询入口
- 需要先验证它是否符合你当前的采集链路预期

### GetCollectionItemCids

用途：读取当前账号的收藏品 CID 列表。

命令名：

```text
GetCollectionItemCids
```

JSON 参数：

```json
{}
```

关注返回：

- `value.cids`
- `value.count`

### GetWarehouseItemList

用途：读取账号级仓库物品计数。

命令名：

```text
GetWarehouseItemList
```

JSON 参数：

```json
{}
```

关注返回：

- `value.items`
- `value.count`
- `value.source`

说明：

- 这份结果不一定只包含交易所藏品 CID

### GetStockCollectibleCounts

用途：从库存容器里按 `itemCid` 聚合数量。

命令名：

```text
GetStockCollectibleCounts
```

JSON 参数：

```json
{}
```

关注返回：

- `value.items`
- `value.containerCount`
- `value.boxCount`

### GetStockContainers

用途：读取库存容器布局快照，常用于批量移仓和定位空位。

命令名：

```text
GetStockContainers
```

JSON 参数：

```json
{}
```

关注返回：

- `value.containers`
- `value.count`
- `value.source`

说明：

- 主仓库可能合法地返回 `stockId: 0`
- `itemUid` 会以字符串返回

### MoveStockItem

用途：移动一个库存物品。

命令名：

```text
MoveStockItem
```

JSON 参数：

```json
{
  "oldStockId": 1,
  "oldSlot": 0,
  "newStockId": 2,
  "newSlot": 5,
  "isRotate": false
}
```

关注返回：

- `value.moved`
- `value.stocksRefreshed`
- `value.containers`

说明：

- 这是写操作，会真实修改游戏内库存布局
- 成功后返回的新 `containers` 应视为下一步操作的权威快照

### GetItemTradeInfo

用途：查询某个藏品当前交易阶梯。

命令名：

```text
GetItemTradeInfo
```

JSON 参数：

```json
{
  "itemCid": 1032006
}
```

也可以使用别名：

```json
{
  "cid": 1032006
}
```

关注返回：

- `value.minPrice`
- `value.tierCount`
- `value.totalCount`
- `value.tiers`

### StartDelayedPriceQuery

用途：启动一个延迟价格查询任务。

命令名：

```text
StartDelayedPriceQuery
```

JSON 参数：

```json
{
  "itemCid": 1083009,
  "delaySeconds": 600,
  "jitterSeconds": 90
}
```

关注返回：

- `value.taskId`
- `value.state`
- `value.actualDelaySeconds`
- `value.remainingSeconds`

说明：

- 同一时刻只能有一个 `scheduled` 或 `running` 的延迟任务

### GetDelayedPriceQueryStatus

用途：查看延迟价格查询任务状态。

命令名：

```text
GetDelayedPriceQueryStatus
```

JSON 参数：

```json
{}
```

关注返回：

- `value.state`
- 如果不是 `idle`，还会包含 `taskId`、`itemCid`、`remainingSeconds`、`result`

### CancelDelayedPriceQuery

用途：取消当前延迟价格查询任务。

命令名：

```text
CancelDelayedPriceQuery
```

JSON 参数，按当前活动任务取消：

```json
{}
```

JSON 参数，指定任务 ID 取消：

```json
{
  "taskId": "delayed-price-1"
}
```

说明：

- 如果指定的 `taskId` 和当前活动任务不一致，会返回 `taskId mismatch`

### ExchangeItem

用途：把藏品上架到交易所。

命令名：

```text
ExchangeItem
```

JSON 参数：

```json
{
  "itemCid": 1011001,
  "count": 1,
  "unitPrice": 12345,
  "timeoutMs": 15000
}
```

也可以使用别名：

```json
{
  "itemId": 1011001,
  "count": 1,
  "unitPrice": 12345
}
```

关注返回：

- `value.result`
- `value.totalPrice`
- `value.stocksRefreshed`
- `value.exchangeItemsRefreshed`

说明：

- 这是写操作，会真实上架物品
- Agent 内部会按 `count * unitPrice` 计算总价

### InvokeMethod

用途：调试性地调用某个 IL2CPP 单例类上的 0 参或 1 个整数参数方法。

命令名：

```text
InvokeMethod
```

JSON 参数，0 参方法：

```json
{
  "class": "PlayerManager",
  "method": "GetSelfTradeInfo"
}
```

JSON 参数，1 个整数参数：

```json
{
  "class": "PlayerManager",
  "method": "GetProfile",
  "arg0": 123456
}
```

关注返回：

- `value.resultClass`

说明：

- 只支持 0 参
- 或 1 个整数 `arg0`
- 不会自动 await 返回的 `Task`

### UnloadAgent

用途：让已注入的 Agent 自行卸载。

命令名：

```text
UnloadAgent
```

JSON 参数：

```json
{
  "delayMs": 200
}
```

也可以直接用默认值：

```json
{}
```

关注返回：

- `value.unloading`
- `value.delayMs`

说明：

- 发出后当前 Agent 会断开
- 之后需要重新注入或重新启动 Agent 才能继续使用 Controller 面板

## 常见组合示例

### 1. 先看当前界面，再导出节点树

命令名：

```text
GetCurrentUI
```

JSON 参数：

```json
{}
```

然后：

命令名：

```text
DumpPanelTree
```

JSON 参数：

```json
{
  "panel": "UIMain"
}
```

### 2. 打开主页并等待主页出现

命令名：

```text
OpenPanel
```

JSON 参数：

```json
{
  "name": "UIMain"
}
```

然后：

命令名：

```text
WaitForVisiblePanel
```

JSON 参数：

```json
{
  "panel": "UIMain",
  "visible": true,
  "timeoutMs": 3000,
  "pollIntervalMs": 50
}
```

### 3. 点击竞拍入口后等待地图界面出现

命令名：

```text
ClickNode
```

JSON 参数：

```json
{
  "panel": "UIMain",
  "path": "MainPanel/mask/Button"
}
```

然后：

命令名：

```text
WaitForVisiblePanel
```

JSON 参数：

```json
{
  "panel": "BattlePrevPanel_Main",
  "visible": true,
  "timeoutMs": 3000,
  "pollIntervalMs": 50
}
```

### 4. 等待仓库出售按钮可用后点击

命令名：

```text
WaitForNode
```

JSON 参数：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/WareHouse",
  "path": "PanelWareHouseSale/Right/Button",
  "pathMode": "exact",
  "state": "interactive"
}
```

然后：

命令名：

```text
ClickNode
```

JSON 参数：

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/WareHouse",
  "path": "PanelWareHouseSale/Right/Button"
}
```

## 备注

- 当前 Controller 页面本质上还是一个泛型 AutoOperation 命令台
- 它已经可直接发送当前 dispatch table 里的所有命令
- 但它还不是高层业务工作流面板，像 `开始竞拍`、`自动出价`、`打开出售页` 这类一键业务命令目前仍需要你自己编排底层原语
