# Controller 驱动 Agent UI 自动化 · 设计文档

> 日期: 2026-06-18 · 状态: 基于当前逆向结果形成的实现前 spec

## 目标

为 `Controller` 后续控制 injected `Agent` 执行游戏内 UI 操作，定义一套最小但可落地的 Agent UI 自动化协议。

本轮目标不是直接实现完整 UI 自动化，而是把下面几件事定清楚：

- 哪些结论已经被逆向结果直接支持
- 哪些内容属于实现层推导
- 首批 Agent UI 原语应该长什么样
- 这些原语如何适配当前 `BKAutoOp` 命名管道协议和手写 JSON 解析器
- 首批应该支持哪些真实业务流程

## 范围

- 基于现有 `BKAutoOp` 协议新增 UI 自动化命令设计
- 约束请求/响应字段、路径匹配规则和错误语义
- 明确首批支持的 UI 组件类型
- 明确优先打通的 2 到 3 条真实流程

## 非目标

- 不在本轮设计完整业务级 `Controller` 命令集
- 不把现有 `GetStockContainers`、`MoveStockItem`、`ExchangeItem` 这类业务直达命令改写成 UI 自动化
- 不继续扩展 `InvokeMethod` 作为通用 UI 自动化入口
- 不在本轮承诺支持任意 Unity 组件、任意输入法场景或任意复杂选择器
- 不在本轮引入新 preload API；继续复用 `runAutoOperationCommand(command, args)`

## 已确认事实

### 1. 现有 Agent 只具备面板级 UI 原语

当前 Agent 已实现以下 UI 相关命令：

- `GetCurrentUI`
- `GetVisiblePanels`
- `OpenPanel`
- `ClosePanel`

实现对应：

- `UIBehavior.GetCurShowMainUI()`
- `UIBehavior.GetAllShowedBhvr()`
- `UIManager.ShowUIByName(string name)`
- `UIManager.AsyncClosePanel()`

这说明现有能力足以做：

- 当前面板观测
- 已知面板打开/关闭

但还不足以做：

- 面板内节点点击
- 文本输入
- 节点状态读取

### 2. `UIWnd.txt` 可以作为面板字典来源

`Archive/BidKing/BidKing_Data/StreamingAssets/Tables/UIWnd.txt` 不是自定义二进制，而是 base64 包裹的 TSV。

解开后可以直接得到：

- panel id
- 中文名
- 窗口类名
- prefab 路径

已确认可直接映射到 `OpenPanel(name)` 的关键窗口包括：

- `UIMain`
- `Battle_Main`
- `BattlePrevPanel_Main`
- `TradingExchange_Main`
- `TradingBuy_Main`
- `TradingPanel`
- `StorePanel`
- `HeroPanel`
- `PackagePanel`
- `AuctionPlacePanel_Main`
- `AuctionContainerPanel`
- `BidPop_Main`
- `PutawayPop_Main`
- `StorePanel_InfoPanel`

因此后续 `Controller` 做面板导航时，应优先使用这些类名，而不是 prefab 路径。

### 3. `Guide.txt` 已泄露部分稳定节点路径

`Archive/BidKing/BidKing_Data/StreamingAssets/Tables/Guide.txt` 同样是 base64 包裹的 TSV。

其中已经出现多条 `panel + transform path` 形式的 UI 节点路径，例如：

- `UIMain` -> `MainPanel/mask/Button`
- `UIMain` -> `WareHousePanel/WareHouse/Down/saleTog`
- `UIMain` -> `WareHousePanel/WareHouse/PanelWareHouseSale/Right/Button`
- `BattlePrevPanel_Main` -> `Panel_1/bg/MapContainer/MapItem_102/Image (1)`
- `BattlePrevPanel_Main` -> `Panel_1/MapPanel/battleSet/Hero/Button_102`
- `BattlePrevPanel_Main` -> `Panel_1/MapPanel/Button`
- `Battle_Main` -> `Gaming/chujia`
- `Battle_Main` -> `InputDevice/Panel1/chujia`

这证明“按 panel 和路径查找节点再执行交互”是对当前游戏 UI 结构的正确抽象，不是凭空假设。

### 4. prefab manifest 已确认首批要支持的 UI 组件族

多个 prefab manifest 已确认出现：

- `UnityEngine.UI.Button/ButtonClickedEvent`
- `UnityEngine.UI.Toggle/ToggleEvent`
- `TMPro.TMP_InputField/*`
- `NumericInputField/NumericInputFieldEvent`
- `UI.Common.ButtonCDClickInCDEvent`

这些组件在以下页面已被观察到：

- `Battle`
- `BattlePrevPanel`
- `BidPop`
- `TradingExchange`
- `AuctionPlacePanel`
- `PutawayPanel`
- `StorePanel_InfoPane`

因此首批 UI 自动化应该围绕：

- `Button`
- `Toggle`
- `TMP_InputField`
- `NumericInputField`

而不是尝试一次性覆盖所有 Unity 组件。

这里要特别区分两层证据：

- `Button` / `Toggle` / `TMP_InputField` / `NumericInputField` 可以被视为 runtime 组件族证据
- `ButtonClickedEvent` / `ToggleEvent` / `ButtonCDClickInCDEvent` 更像是在证明 prefab 上存在对应事件字段或自定义脚本参与，不应直接当成外部协议暴露的 `componentTypes`

因此对外协议的 `component` / `componentTypes` 应规范化为高层组件族，不把 manifest 中的事件序列化类型原样暴露出去。

### 5. 当前管道协议和 JSON 解析器存在明确限制

当前 `BKAutoOp` 协议约束：

- 帧上限 `262144` bytes
- 请求格式仍是 `{ id, cmd, args }`
- Agent 侧字段提取依赖极简 `JsonGetString` / `JsonGetInt` / `JsonGetBool`

这意味着首批协议设计必须遵守：

- `args` 保持扁平
- 避免嵌套 selector 对象
- 避免依赖复杂 JSON 转义
- 响应体必须可控，不能无界导出整棵 UI 树

### 6. 当前 bridge 只支持“一次命令，一次连接，一个 response”

当前 Agent 连接模型是：

- 每个客户端连接对应一个 `ConnectionHandler`
- 命令在连接线程里直接 `DispatchCommand(...)`

当前 Electron bridge 模型是：

- `sendAutoOperationCommand(...)` 每次命令新建一次 pipe 连接
- 收到第一个 `id` 匹配的 response 后立即销毁 socket
- renderer 当前不保留可持续消费 unsolicited event 的连接

这意味着：

- Phase 1 UI 命令必须完全适配当前 one-shot request/response 契约
- 不能把“先返回 queued，再等 event”当成 Phase 1 的隐藏前提
- 如果未来确实需要持久事件流，那不是“单独补一点事件模型”，而是要同时改 Agent、Electron bridge 和 renderer 契约的单独设计轮次

### 7. 当前已有 UI 命令本身已经存在异步完成风险

当前：

- `OpenPanel` 只是调用 `ShowUIByName` 后立即返回
- `ClosePanel` 调用的就是 `AsyncClosePanel`

因此后续 `Controller` 编排不能默认“上一步返回即代表 UI 已稳定”，Phase 1 必须同时提供最小等待原语。

## 实现层推导

下面这些不是当前游戏里已确认存在的现成 API 名，而是基于上面的事实，为了让 `Controller` 真正可用而推导出的 Agent 原语。

### 为什么不能继续扩 `InvokeMethod`

当前 `InvokeMethod` 只支持：

- 0 参方法
- 1 个 `int arg0`
- 返回值只暴露 `resultClass`

它不适合 UI 自动化，原因包括：

- 无法表达路径选择器
- 无法表达字符串输入
- 无法读取节点文本/可交互状态
- 会把 `Controller` 再次拉回底层调试命令台模型

因此 UI 自动化必须使用专门命令，而不是继续滥用 `InvokeMethod`。

### 为什么需要 `DumpPanelTree`

`Guide.txt` 只覆盖了部分流程和部分节点。

像以下页面，目前没有看到完整静态 guide 路径：

- `AuctionPlacePanel_Main`
- `AuctionContainerPanel`
- `PackagePanel`
- `StorePanel`
- `HeroPanel`

如果没有运行时节点导出能力，后续每接一个页面都需要重新盲猜路径，维护成本过高。

因此 `DumpPanelTree` 不是“已逆向出的现成游戏函数”，而是一个高置信度、工程上必要的补全原语。

## 设计原则

### 1. 业务直达命令优先，UI 自动化补空白

已有以下命令时，不应强行改走 UI 自动化：

- `GetStockContainers`
- `MoveStockItem`
- `GetItemTradeInfo`
- `ExchangeItem`

UI 自动化优先用于：

- 面板导航
- 页面内按钮点击
- 键盘面板或输入框输入
- 缺乏现成业务命令的流程

### 2. 首批协议只暴露低层 UI 原语，不暴露业务意图

本轮新增命令只负责：

- 看 UI 树
- 找节点
- 点节点
- 填文本

不直接定义：

- `StartAuction`
- `BidPrice`
- `OpenWarehouseSale`

这些业务级意图应由 `Controller` 在 renderer 侧用多个低层命令编排。

### 3. 选择器先做简单、稳定、可测

首批只支持：

- `exact`
- `glob`

不支持：

- 正则
- CSS/XPath 风格选择器
- 嵌套条件表达式

原因：

- 当前 parser 太弱
- 当前已知证据主要是完整 path
- 动态节点 id 可以通过 `glob` 中的 `*` 覆盖

### 4. `panel` 只表示顶层可见 root，不表示任意子面板名字

`panel` 的语义必须固定为：

- 当前可见的顶层 UI root
- 即运行时可由 `GetVisiblePanels()` 观察到的 panel class name

`panel` 不能直接表示：

- 任意嵌套子树名
- 任意 transform 节点名
- 仅存在于美术或 prefab 语义中的逻辑分区名

为了解决 `UIMain` 下嵌套面板和弹窗路径寻址，需要额外引入：

- `rootPath`
- `path`

其中：

- `rootPath` 用于把选择范围锚定到某个子树
- `path` 相对于 `rootPath` 求值

如果某个弹窗本身就是独立可见 root，并且能被 `GetVisiblePanels()` 观察到，例如 `BidPop_Main`，则可以直接作为 `panel`。

如果某个 UI 只是当前顶层 panel 内的嵌套子树，则必须使用“顶层 `panel` + `rootPath`”寻址，而不能把子树名直接塞进 `panel`。

## 协议设计

### 复用现有外层信封

仍使用当前 `BKAutoOp` 请求/响应信封：

```json
{
  "id": "1",
  "cmd": "ClickNode",
  "args": {
    "panel": "BattlePrevPanel_Main",
    "path": "Panel_1/MapPanel/Button"
  }
}
```

成功响应：

```json
{
  "id": "1",
  "ok": true,
  "result": {}
}
```

失败响应：

```json
{
  "id": "1",
  "ok": false,
  "error": "error message"
}
```

### Phase 1 命令集合

Phase 1 强制包含：

- `DumpPanelTree`
- `ClickNode`
- `SetInputText`
- `GetNodeState`
- `WaitForVisiblePanel`
- `WaitForNode`

原因：

- 当前 bridge 不支持异步事件流
- 当前 `OpenPanel` / `ClosePanel` 已经存在异步完成风险
- 没有等待原语的话，`Controller` 只能在 renderer 里各自发明轮询逻辑

## 命令细节

### `DumpPanelTree`

用途：

- 导出某个可见 panel 下的 UI 节点快照
- 让 `Controller` 或开发者确认路径、组件类型和当前可交互节点

请求：

```json
{
  "id": "1",
  "cmd": "DumpPanelTree",
  "args": {
    "panel": "BattlePrevPanel_Main",
    "rootPath": "",
    "maxDepth": 4,
    "interactiveOnly": true,
    "includeInactive": false,
    "nodeLimit": 200
  }
}
```

字段约束：

- `panel`: 必填，表示顶层可见 root 的窗口类名；通常来自 `UIWnd`，但运行时必须能被 `GetVisiblePanels()` 观察到
- `rootPath`: 选填，默认为空，表示从顶层可见 panel root 开始
- `maxDepth`: 选填，默认 `4`，必须为整数，允许范围固定为 `0..8`
- `interactiveOnly`: 选填，默认 `true`
- `includeInactive`: 选填，默认 `false`
- `nodeLimit`: 选填，默认 `200`，必须为整数，允许范围固定为 `1..1000`
- 越界值必须显式报错，不允许静默 clamp 到其他合法值
- `maxDepth` 越界时返回 `invalid maxDepth`
- `nodeLimit` 越界时返回 `invalid nodeLimit`

成功结果：

```json
{
  "panel": "BattlePrevPanel_Main",
  "rootPath": "",
  "truncated": false,
  "nodes": [
    {
      "path": "Panel_1/MapPanel/Button",
      "name": "Button",
      "depth": 3,
      "active": true,
      "interactive": true,
      "componentTypes": ["Button"]
    }
  ]
}
```

返回约束：

- 返回扁平节点数组，不返回递归树
- `nodes[].path` 一律相对于本次请求的遍历锚点返回：
  - 当 `rootPath = ""` 时，相对于顶层 `panel` root
  - 当 `rootPath` 非空时，相对于已解析的 `rootPath` 子树
- `DumpPanelTree` 不应把 `rootPath` 前缀重复拼进 `nodes[].path`
- 这保证了调用方可以直接复用同一组 `panel + rootPath + path` 去回放 `ClickNode` / `SetInputText` / `GetNodeState`
- `componentTypes` 保持简短，不导出完整反射信息
- 超过 `nodeLimit` 时必须返回 `truncated: true`

失败语义：

- `panel not visible`
- `panel instance not found`
- `root path not found`
- `invalid maxDepth`
- `invalid nodeLimit`
- `dump result too large`

实现说明：

- 先通过 `UIBehavior.GetAllShowedBhvr()` 找到可见 panel 实例
- 用 panel 实例的 class name 与 `panel` 参数匹配
- 在该 panel 根下遍历 Transform 树
- 如果 `rootPath` 非空，则先解析 `rootPath` 对应子树，再从该子树向下遍历

### `ClickNode`

用途：

- 对 panel 内目标节点执行点击类交互

请求：

```json
{
  "id": "2",
  "cmd": "ClickNode",
  "args": {
    "panel": "BattlePrevPanel_Main",
    "rootPath": "",
    "path": "Panel_1/MapPanel/Button",
    "pathMode": "exact",
    "component": "auto"
  }
}
```

字段约束：

- `panel`: 必填，表示顶层可见 root 的窗口类名
- `rootPath`: 选填，默认空字符串
- `path`: 必填
- `pathMode`: 选填，默认 `exact`
- `component`: 选填，默认 `auto`

`pathMode` 首批允许：

- `exact`: 全路径精确匹配
- `glob`: 支持 `*` 通配，例如 `Panel_1/bg/MapContainer/MapItem_*/Image (1)`

`component` 首批允许：

- `auto`
- `button`
- `toggle`

任何不在上述列表内的值：

- `pathMode` 必须返回 `invalid pathMode`
- `component` 必须返回 `invalid component`
- 不允许静默回落到默认值

成功结果：

```json
{
  "clicked": true,
  "resolvedPath": "Panel_1/MapPanel/Button",
  "component": "button"
}
```

返回约束：

- `resolvedPath` 必须返回最终命中的精确节点路径
- `resolvedPath` 的基准必须与请求 `path` 的求值锚点一致：
  - 当 `rootPath = ""` 时，相对于顶层 `panel` root
  - 当 `rootPath` 非空时，相对于已解析的 `rootPath` 子树
- `resolvedPath` 不应重复拼接 `rootPath` 前缀
- 调用方必须能够直接复用同一组 `panel + rootPath + resolvedPath` 再次发起节点命令

失败语义：

- `panel not visible`
- `root path not found`
- `node not found`
- `multiple nodes matched`
- `invalid pathMode`
- `node inactive`
- `node not clickable`
- `invalid component`
- `component mismatch`

实现优先级：

当 `component = auto` 时，按下面顺序尝试：

1. `Button`
2. `Toggle`

首批不做：

- 基于屏幕坐标的鼠标点击
- 通用 `IPointerClickHandler` 扫描
- 长按、双击、拖拽

### `SetInputText`

用途：

- 向 panel 内输入控件写入文本
- 覆盖数字输入、交易输入、出价输入等场景

请求：

```json
{
  "id": "3",
  "cmd": "SetInputText",
  "args": {
    "panel": "BidPop_Main",
    "rootPath": "",
    "path": "Panel/InputField",
    "pathMode": "exact",
    "text": "45000",
    "submit": false
  }
}
```

字段约束：

- `panel`: 必填，表示顶层可见 root 的窗口类名
- `rootPath`: 选填，默认空字符串
- `path`: 必填
- `pathMode`: 选填，默认 `exact`
- `text`: 必填
- `submit`: 选填，默认 `false`

`pathMode` 首批允许：

- `exact`
- `glob`

任何不在上述列表内的值：

- 必须返回 `invalid pathMode`
- 不允许静默回落到默认值

首批输入组件支持范围：

- `TMP_InputField`
- `NumericInputField`

成功结果：

```json
{
  "updated": true,
  "resolvedPath": "Panel/InputField",
  "component": "numeric-input",
  "text": "45000"
}
```

返回约束：

- `resolvedPath` 必须返回最终命中的精确输入节点路径
- `resolvedPath` 的基准必须与请求 `path` 的求值锚点一致：
  - 当 `rootPath = ""` 时，相对于顶层 `panel` root
  - 当 `rootPath` 非空时，相对于已解析的 `rootPath` 子树
- `resolvedPath` 不应重复拼接 `rootPath` 前缀
- 调用方必须能够直接复用同一组 `panel + rootPath + resolvedPath` 再次发起节点命令

失败语义：

- `panel not visible`
- `root path not found`
- `node not found`
- `multiple nodes matched`
- `invalid pathMode`
- `node inactive`
- `node not input`
- `text too long`

实现约束：

- Phase 1 仅承诺支持简单字符串
- 第一版 `text` 应限制为不含换行和双引号
- 如需支持更复杂文本，必须先增强 parser

### `GetNodeState`

用途：

- 读取节点文本、是否激活、是否可交互、toggle 选中态
- 用于 `Controller` 编排后的校验

请求：

```json
{
  "id": "4",
  "cmd": "GetNodeState",
  "args": {
    "panel": "Battle_Main",
    "rootPath": "",
    "path": "WareHouse/Bottom/yuguPrice",
    "pathMode": "exact"
  }
}
```

字段约束：

- `panel`: 必填，表示顶层可见 root 的窗口类名
- `rootPath`: 选填，默认空字符串
- `path`: 必填
- `pathMode`: 选填，默认 `exact`

`pathMode` 首批允许：

- `exact`
- `glob`

任何不在上述列表内的值：

- 必须返回 `invalid pathMode`
- 不允许静默回落到默认值

成功结果示例：

```json
{
  "resolvedPath": "WareHouse/Bottom/yuguPrice",
  "active": true,
  "interactive": false,
  "text": "45000",
  "toggleOn": false
}
```

返回约束：

- `resolvedPath` 必须返回最终命中的精确节点路径
- `resolvedPath` 的基准必须与请求 `path` 的求值锚点一致：
  - 当 `rootPath = ""` 时，相对于顶层 `panel` root
  - 当 `rootPath` 非空时，相对于已解析的 `rootPath` 子树
- `resolvedPath` 不应重复拼接 `rootPath` 前缀
- 调用方必须能够直接复用同一组 `panel + rootPath + resolvedPath` 再次发起节点命令

失败语义：

- `panel not visible`
- `root path not found`
- `node not found`
- `multiple nodes matched`
- `invalid pathMode`

### `WaitForVisiblePanel`

用途：

- 等待某个顶层 panel 变为可见或不可见
- 为 `OpenPanel` / `ClosePanel` 后的同步编排提供最小等待原语

请求：

```json
{
  "id": "5",
  "cmd": "WaitForVisiblePanel",
  "args": {
    "panel": "BattlePrevPanel_Main",
    "visible": true,
    "timeoutMs": 3000,
    "pollIntervalMs": 50
  }
}
```

字段约束：

- `panel`: 必填，表示要观察的顶层 panel 类名
- `visible`: 选填，默认 `true`
- `timeoutMs`: 选填，默认 `3000`，必须为整数，允许范围固定为 `100..30000`
- `pollIntervalMs`: 选填，默认 `50`，必须为整数，允许范围固定为 `16..1000`
- `pollIntervalMs` 必须小于等于 `timeoutMs`
- 上述默认值和上下限是协议常量；Agent 校验、bridge 超时派生和测试断言都必须使用同一组边界，不能各自发明阈值

成功结果：

```json
{
  "panel": "BattlePrevPanel_Main",
  "visible": true,
  "waitMs": 180
}
```

失败语义：

- `wait panel timeout`
- `invalid timeoutMs`
- `invalid pollIntervalMs`

超时契约：

- `timeoutMs` 表示 Agent 侧等待预算，不是仅供 renderer 展示的软提示
- 对 `WaitForVisiblePanel` 的整次调用，Electron bridge 命令超时必须从生效后的 `timeoutMs` 派生，并额外预留一个小的固定缓冲
- 不能继续落回未知命令默认 `5000ms`，否则调用方一旦传入更大的等待预算，bridge 会先于 Agent 超时
- 在支持范围内，调用方观察到的超时应优先表现为 Agent 返回的 `wait panel timeout`，而不是 bridge 层连接超时

### `WaitForNode`

用途：

- 等待某个节点出现并满足最小状态
- 避免 renderer 重复发明轮询逻辑

请求：

```json
{
  "id": "6",
  "cmd": "WaitForNode",
  "args": {
    "panel": "Battle_Main",
    "rootPath": "InputDevice/Panel1",
    "path": "chujia",
    "pathMode": "exact",
    "state": "active",
    "timeoutMs": 2000,
    "pollIntervalMs": 50
  }
}
```

字段约束：

- `panel`: 必填，表示要观察的顶层 panel 类名
- `rootPath`: 选填，默认空字符串
- `path`: 必填
- `pathMode`: 选填，默认 `exact`
- `state`: 必填
- `timeoutMs` / `pollIntervalMs` 沿用上面的共享等待参数约束

`pathMode` 首批允许：

- `exact`
- `glob`

`state` 首批允许：

- `exists`
- `active`
- `interactive`

任何不在上述枚举列表内的值：

- `pathMode` 必须返回 `invalid pathMode`
- `state` 必须返回 `invalid state`
- 不允许静默回落到默认值

成功结果：

```json
{
  "resolvedPath": "chujia",
  "state": "active",
  "waitMs": 120
}
```

返回约束：

- `resolvedPath` 必须返回最终命中的精确节点路径
- `resolvedPath` 的基准必须与请求 `path` 的求值锚点一致：
  - 当 `rootPath = ""` 时，相对于顶层 `panel` root
  - 当 `rootPath` 非空时，相对于已解析的 `rootPath` 子树
- `resolvedPath` 不应重复拼接 `rootPath` 前缀
- 调用方必须能够直接复用同一组 `panel + rootPath + resolvedPath` 再次发起节点命令

失败语义：

- `wait node timeout`
- `multiple nodes matched`
- `invalid pathMode`
- `invalid state`
- `invalid timeoutMs`
- `invalid pollIntervalMs`

轮询语义：

- 轮询过程中，以下情况都属于内部瞬时未命中状态，必须继续轮询，而不是立刻对外返回失败：
  - 顶层 `panel` 当前尚未可见
  - `rootPath` 当前尚未解析到子树
  - `path` 当前尚未匹配到节点
  - 已匹配到节点但尚未满足目标 `state`
- 如果在 `timeoutMs` 内始终没有得到“单一匹配且满足目标状态”的结果，则统一返回 `wait node timeout`
- `node not found` 不应作为 `WaitForNode` 的对外终态错误；它最多只能是轮询过程中的内部观测
- `multiple nodes matched` 仍然是立即失败，因为等待不会消除选择器歧义
- 立即失败只保留给不可恢复输入错误，例如不支持的 `pathMode` / `state`、非法的 `timeoutMs` / `pollIntervalMs`、或超出协议预算的参数

## 路径与匹配规则

### 路径格式

统一使用 Unity Transform 风格路径：

```text
Parent/Child/Leaf
```

路径分隔符固定为 `/`。

不支持：

- `\`
- 数组下标语法
- CSS 选择器

### `glob` 规则

首批只支持 `*`：

- `*` 匹配任意长度字符
- 不单独支持 `?`
- 按整条路径做 glob，不按单段做复杂表达式

示例：

```text
Panel_1/bg/MapContainer/MapItem_*/Image (1)
```

这样可以覆盖 guide 中的动态节点 id，如：

- `MapItem_102`
- `herochooseItem_107`
- `GridItem_35`

### 多匹配策略

对 `ClickNode` 和 `SetInputText`：

- 默认不允许多匹配
- 若匹配多于一个节点，返回 `multiple nodes matched`

原因：

- 静默选第一个节点风险过高
- 不利于后续稳定自动化

### `rootPath` 规则

对所有节点类命令：

- 先定位顶层 `panel`
- 再定位 `rootPath`
- 最后在 `rootPath` 下解析 `path`

当 `rootPath = ""` 时：

- `path` 直接相对于顶层 `panel` root 求值

这让两类场景都可表达：

- 顶层 root 自己就是目标，例如 `BattlePrevPanel_Main`
- 顶层 root 下的嵌套子树才是目标，例如 `UIMain` 下的 `WareHousePanel`

错误语义统一规则：

- 对 `DumpPanelTree`、`ClickNode`、`SetInputText`、`GetNodeState`，如果 `rootPath` 非空且在当前顶层 `panel` 下无法解析，必须返回 `root path not found`
- 不能把“`rootPath` 锚点不存在”和“`path` 在已定位子树下未命中”都折叠成同一个 `node not found`
- `WaitForNode` 是唯一例外：轮询期间 `rootPath` 暂未解析成功属于内部瞬时状态，最终失败应统一表现为 `wait node timeout`

`resolvedPath` 统一规则：

- 对 `ClickNode`、`SetInputText`、`GetNodeState`、`WaitForNode`，成功结果中的 `resolvedPath` 必须与请求 `path` 使用同一个求值基准
- 当 `rootPath = ""` 时，`resolvedPath` 相对于顶层 `panel` root
- 当 `rootPath` 非空时，`resolvedPath` 相对于已解析的 `rootPath` 子树
- `resolvedPath` 不应重复拼接 `rootPath` 前缀
- 这保证了调用方可以直接复用同一组 `panel + rootPath + resolvedPath` 去回放或串联后续节点命令

## 首批真实流程

### Flow A: 主页进入竞拍准备并点击出击

目标：

- 从 `UIMain` 进入 `BattlePrevPanel_Main`
- 选择地图
- 选择角色
- 点击出击

证据来源：

- `Guide.txt` 已给出 `MainPanel/mask/Button`
- `Guide.txt` 已给出 `BattlePrevPanel_Main` 下地图、角色、出击路径

建议编排：

1. `OpenPanel("UIMain")`
2. `WaitForVisiblePanel("UIMain")`
3. `ClickNode("UIMain", "", "MainPanel/mask/Button")`
4. `WaitForVisiblePanel("BattlePrevPanel_Main")`
5. `WaitForNode("BattlePrevPanel_Main", "", "Panel_1/bg/MapContainer/MapItem_*/Image (1)", "glob", "interactive")`
6. `ClickNode("BattlePrevPanel_Main", "", "Panel_1/bg/MapContainer/MapItem_*/Image (1)", "glob")`
7. `ClickNode("BattlePrevPanel_Main", "", "Panel_1/MapPanel/battleSet/Hero/Button_*", "glob")`
8. `ClickNode("BattlePrevPanel_Main", "", "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_*/button", "glob")`
9. `WaitForNode("BattlePrevPanel_Main", "", "Panel_1/MapPanel/Button", "exact", "interactive")`
10. `ClickNode("BattlePrevPanel_Main", "", "Panel_1/MapPanel/Button")`

### Flow B: 战斗内输入出价并确认

目标：

- 在 `Battle_Main` 内输入价格
- 点击确认出价

证据来源：

- `Guide.txt` 已给出 `Gaming/chujia`
- `Guide.txt` 已给出数字键和确认路径
- `battle.data.manifest` 已确认存在 `NumericInputField`

建议编排：

1. `ClickNode("Battle_Main", "", "Gaming/chujia")`
2. `WaitForNode("Battle_Main", "", "InputDevice/Panel1/chujia", "exact", "active")`
3. 若已确认输入面板存在稳定 input 节点，则走 `SetInputText(...)` 路径
4. 若尚未确认稳定 input selector，或该面板实际更适合通过数字键盘节点驱动输入，则走键盘节点点击路径：
   - `ClickNode("Battle_Main", "", "InputDevice/Panel1/GameObject/GameObject/number (4)")`
   - `ClickNode("Battle_Main", "", "InputDevice/Panel1/GameObject/GameObject/number (5)")`
   - `ClickNode("Battle_Main", "", "InputDevice/Panel1/GameObject/GameObject/number (000)")`
5. `ClickNode("Battle_Main", "", "InputDevice/Panel1/chujia")`

说明：

- 这里区分的是两条可接受的运行时交互路径，不是“Task 6 编排时某个能力还没实现”
- `Task 4` 的验收可先走第 `1/2/4/5` 步，以独立验证 `ClickNode`
- `Task 5` 在确认稳定 input selector 后，再补第 `1/2/3/5` 步，作为 `SetInputText` 的增强验收
- `Task 6` 编排 `Flow B` 时，应优先采用逆向证据更稳定的那条路径，另一条作为回退或补充覆盖

### Flow C: 主页打开仓库出售入口

目标：

- 从 `UIMain` 进入出售相关 UI

证据来源：

- `Guide.txt` 已给出：
  - `MainPanel/Btns2/Button_1`
  - `WareHousePanel/WareHouse/Down/saleTog`
  - `WareHousePanel/WareHouse/PanelWareHouseSale/Right/Button`

这个流程适合作为 `Toggle` 和普通 `Button` 混合验收路径。

建议编排：

1. `WaitForVisiblePanel("UIMain")`
2. `ClickNode("UIMain", "", "MainPanel/Btns2/Button_1")`
3. `WaitForNode("UIMain", "WareHousePanel/WareHouse", "Down/saleTog", "exact", "interactive")`
4. `ClickNode("UIMain", "WareHousePanel/WareHouse", "Down/saleTog")`
5. `WaitForNode("UIMain", "WareHousePanel/WareHouse", "PanelWareHouseSale/Right/Button", "exact", "interactive")`
6. `ClickNode("UIMain", "WareHousePanel/WareHouse", "PanelWareHouseSale/Right/Button")`

## 对 Agent 实现的具体约束

### 1. 请求字段必须保持扁平

允许：

```json
{
  "panel": "Battle_Main",
  "rootPath": "",
  "path": "Gaming/chujia",
  "pathMode": "exact"
}
```

不允许：

```json
{
  "selector": {
    "panel": "Battle_Main",
    "path": "Gaming/chujia"
  }
}
```

原因是当前 `JsonGetString` 不是完整 JSON parser。

### 2. 新字符串缓冲区必须大于现有 `OpenPanel` 级别

当前 `OpenPanel` 的 `name` 缓冲只有 `64` 字节。

新命令建议：

- `panel[96]`
- `rootPath[512]`
- `path[512]`
- `text[512]`
- `pathMode[16]`
- `component[16]`

### 3. `DumpPanelTree` 结果必须受限

必须至少同时限制：

- `maxDepth`
- `nodeLimit`

必要时还要在构建响应 JSON 时检测：

- `result too large`

不能让单次导出无限接近 `BK_BUF_SIZE`。

### 4. Phase 1 必须完全服从当前同步 bridge 契约

Phase 1 新命令必须沿用当前同步请求/响应模型：

- 收到命令
- 在 Agent 内执行
- 直接返回结果

明确不允许把以下语义留作 Phase 1 隐含前提：

- `queued`
- `OperationDone`
- UI 事件流

如果某些 UI 操作最终必须切到 Unity 主线程：

- Agent 也必须在同一次命令调用中等待该主线程动作完成
- 然后再在同一个 response 里返回结果或超时

若未来确实要引入持续事件流，必须单独起一个 bridge redesign 设计轮次，同时修改：

- Agent 连接模型
- `electron/services/inject-service.js`
- renderer 消费契约

### 5. Wait 命令的 bridge 超时必须跟随 `args.timeoutMs`

对 `WaitForVisiblePanel` 和 `WaitForNode`：

- `electron/services/inject-service.js` 不能继续把它们当作普通未知命令，直接套用默认 `DEFAULT_AUTO_OPERATION_TIMEOUT_MS`
- 当 `args.timeoutMs` 缺省时，bridge 命令超时必须按协议默认值 `3000ms` 派生，并额外增加一小段固定缓冲，用于覆盖 IPC / socket / JSON 编解码开销
- 当 `args.timeoutMs` 显式提供且落在协议允许范围内时，bridge 命令超时必须由该值派生，并额外增加同样的固定缓冲
- 这个派生超时必须保证：只要 `args.timeoutMs` 在 spec 允许范围内，Agent 自己的等待逻辑就有机会先结束并返回规范化错误
- bridge 不允许把越界 `timeoutMs` 静默 clamp 成另一个合法值再透传
- 如果实现需要对 wait 命令设置统一上限，也必须把这个上限写进协议文档和 bridge 校验，而不能依赖隐式默认值

## 测试范围

### Agent 级

- `DumpPanelTree` 参数缺失、`invalid maxDepth` / `invalid nodeLimit`、层级限制、截断标记
- `DumpPanelTree` 在 `rootPath` 为空 / 非空时都返回可直接回放的相对 `nodes[].path`
- `WaitForVisiblePanel` 的默认参数、最小 / 最大合法边界、非法 `timeoutMs` / `pollIntervalMs`、以及可见性判定
- `WaitForNode` 的默认参数、最小 / 最大合法边界、非法 `pathMode` / `state` / `timeoutMs` / `pollIntervalMs`、瞬时未命中持续轮询、超时和多匹配失败
- `ClickNode` / `SetInputText` / `GetNodeState` / `WaitForNode` 在 `rootPath` 为空 / 非空时都返回可直接回放的相对 `resolvedPath`
- `GetNodeState` 的文本 / 交互态读取与 `invalid pathMode`
- `ClickNode` 的 `exact` / `glob` 匹配与 `invalid pathMode` / `invalid component`
- `ClickNode` 单匹配与多匹配失败
- `SetInputText` 的文本长度、组件类型校验与 `invalid pathMode`

### Electron / bridge 级

- `runAutoOperationCommand('DumpPanelTree', args)` 能原样透传
- `WaitForVisiblePanel` / `WaitForNode` 在 `timeoutMs` 缺省时，会按协议默认值 `3000ms` 加固定缓冲派生命令超时
- `WaitForVisiblePanel` / `WaitForNode` 传入大于默认 `5000ms` 的 `timeoutMs` 时，bridge 超时会随 `args.timeoutMs` 派生，而不会提前在 bridge 层超时
- 越界 `timeoutMs` 不会被 bridge 静默改写成另一个合法值
- 新命令失败时错误能抛回 renderer
- 大响应不会破坏既有 frame 处理

### Controller 编排级

- `Flow A` 主页到出击
- `Flow B` 战斗内输入出价并确认
- `Flow C` 主页到出售入口

## 推荐实施顺序

### Task 1

实现 Agent 帮助函数：

- 查找可见 panel 实例
- Transform 路径遍历
- 组件族识别
- `rootPath` 锚定

### Task 2

实现 `DumpPanelTree`

原因：

- 它能为后续 `ClickNode` 和 `SetInputText` 提供调试支撑

### Task 3

实现 `WaitForVisiblePanel`、`WaitForNode`、`GetNodeState`

原因：

- 它们是 Phase 1 消除竞态的必要原语

### Task 4

实现 `ClickNode`

优先支持：

- `Button`
- `Toggle`

### Task 5

实现 `SetInputText`

优先支持：

- `TMP_InputField`
- `NumericInputField`

### Task 6

在 `Controller` 或临时开发入口里编排 `Flow A`、`Flow B`、`Flow C`

## 决策结论

本 spec 的核心结论是：

- `ClickNode` 和 `SetInputText` 的能力需求，有直接逆向证据支持
- `DumpPanelTree` 不是已逆出的现成游戏 API，而是为了补足静态 guide 覆盖不足而做的高置信度实现推导
- Phase 1 必须当前就服从现有 one-shot 同步 bridge 契约，不能把事件流当作后续平滑补丁
- `panel` 必须固定为顶层可见 root；嵌套子树通过 `rootPath + path` 寻址
- 对外 `componentTypes` 只暴露规范化组件族，不直接暴露 manifest 里的事件序列化类型
- 首批协议应保持低层、扁平、可测，不应继续走 `InvokeMethod` 的大口子路线
- 首批实现应该优先打通 `主页 -> 竞拍准备 -> 出击` 与 `主页 -> 出售入口` 两条流程，再扩大战斗出价和交易页面覆盖
