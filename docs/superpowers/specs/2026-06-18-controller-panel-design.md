# Inject Controller Panel · 设计文档

> 日期: 2026-06-18 · 状态: 设计已确认，待用户审阅 spec

## 目标

在 `Inject` 页面左侧 `基础` 分组下新增一个独立的 `Controller` 入口和 panel，用来承载“未来通过 controller 与 injected agent 通信、执行游戏内操作”的工作台壳层。

本次设计的目标是先把信息架构、组件边界和交互骨架定下来，而不是在同一轮里直接打通新的 controller 通信协议。

首版需要满足：

- `Inject` 左侧导航新增 `Controller`
- `Controller` panel 作为独立组件接入现有 workspace shell
- panel 内包含：
  - 连接与可用性状态区
  - `Controller` 命令区的交互骨架
  - 未来业务操作区的分区骨架
- 明确区分 `Controller` 与现有 `Agent 状态` panel 的职责

## 范围

- 更新 `Inject` 左侧导航，在 `基础` 分组下新增 `Controller`
- 新增独立 `InjectControllerPanel` 组件
- 为 `Controller` panel 增加首版本地状态模型
- 增加中英文 i18n 文案，并明确中文标签使用 `控制器`
- 补齐 panel 级和页级测试，覆盖导航接入和壳层行为
- 当实现实际改变 `Inject` panel 清单与信息架构时，同轮更新 `docs/Documentation.md` 与 `docs/ARCHITECTURE.md`

## 非目标

- 不在本轮新增真实的 controller IPC / preload bridge
- 不在本轮复用或改写 `runAutoOperationCommand(command, args)` 的协议语义
- 不把现有 `Agent 状态` panel 合并进 `Controller`
- 不在本轮为业务操作区填入真实按钮、表单或命令流
- 不做日志落盘、跨页面持久化或 Documents 输出

## 已确认上下文

### 当前 Inject 页面结构

`src/inject/App.vue` 当前已经是工作台壳层：

- 左侧导航按 `基础 / 交易` 分组
- 右侧区域只显示一个激活 panel
- panel 首次访问后保留实例，通过 `v-if + v-show` 保持局部状态

当前 `基础` 分组包含：

- `柜子奖励`
- `Agent 状态`

当前 `Agent 状态` panel 已经承担：

- agent 注入与连接状态
- 命名管道可用性判断
- 一组底层 `AutoOperation` 命令按钮
- 命令返回结果展示

这意味着新增 `Controller` 时，必须避免把“底层 agent 调试命令”与“未来 controller 业务操作台”继续混在同一个 panel 中。

### 当前桌面桥接能力

`electron/preload.js` 当前暴露的是 `bidkingDesktop` 桌面桥接，其中和 Agent 相关的主要能力是：

- `startAutoOperationAgent()`
- `runAutoOperationCommand(command, args)`

本轮没有现成的 `runControllerCommand(...)` 能力，因此 `Controller` panel 首版只能落壳层，不能伪装成已接入真实 controller 通道。

### 当前共享 Agent runtime

项目已经有共享的 agent runtime：`src/shared/useAutoOperationAgentSwitch.js`。

这套共享 runtime 当前负责：

- 探测桌面桥与 agent 命令能力是否存在
- 通过 `Ping` 刷新 agent 当前连接态
- 让 TopBar、`Agent 状态` panel 等界面看到一致的连接状态与状态文案

因此 `Controller` panel 的 readiness 不能只看“桥接能力是否存在”，还必须读取共享 runtime 暴露的 agent 当前连接态，否则会和顶栏、`Agent 状态` panel 形成冲突信息。

## 方案比较

### A. 新增独立 Controller panel，推荐

保留现有 `Agent 状态` panel 负责 agent 生命周期与底层调试；新增 `Controller` panel，专门承载未来 controller 驱动的游戏内操作工作台。

优点：

- 职责边界最清晰
- 后续新增业务操作时不会继续把 `Agent` panel 做重
- 与用户“新增 Controller”的心智一致

缺点：

- 左侧导航会增加一个入口

### B. 直接把 Agent 状态 扩成 Controller

不新增入口，继续在当前 `Agent 状态` panel 上追加 controller 区块。

优点：

- 表面上入口更少

缺点：

- 生命周期诊断、底层命令、未来业务操作会继续混杂
- 面板职责会越来越模糊
- 长期维护成本更高

### C. 新增 Controller 并在首版加入内部子导航

在独立 `Controller` panel 内再拆 `连接 / 通用命令 / 业务操作` 子页。

优点：

- 扩展性强

缺点：

- 对当前阶段明显过度设计
- 真实协议尚未接入时，子导航价值不高

### 结论

采用 **A 作为本轮方案**：

- 左侧新增独立 `Controller`
- 保留 `Agent 状态` 继续承担 agent 注入与底层命令调试
- `Controller` 首版只做清晰可扩展的 UI 骨架，不假装已接通真实通信

## 信息架构

`Inject` 左侧 `基础` 分组调整为：

- `柜子奖励`
- `Agent 状态`
- `控制器`

其中 `控制器` 放在 `Agent 状态` 后面，表达“它依赖 agent 能力，但职责更偏上层操作编排”。

对应 i18n 约定：

- 中文：`inject.nav.controller = 控制器`
- 英文：`inject.nav.controller = Controller`
- 中文：`inject.controllerTitle = 控制器`
- 英文：`inject.controllerTitle = Controller`
- 中文：`inject.controllerSubtitle = 通过 controller 与 injected agent 通信，并承载后续游戏内操作`
- 英文：`inject.controllerSubtitle = Communicate with the injected agent through the controller and host future in-game operations`

这样能和当前 `inject.nav.*` 的本地化结构保持一致，也避免中文模式下出现 `柜子奖励 / Agent 状态 / Controller` 这种不完整混排。

## 组件设计

建议新增：

- `src/inject/panels/InjectControllerPanel.vue`

并在 `src/inject/App.vue` 中：

- 注册 `controller` 导航项
- 将 `Controller` 接入现有 panel host
- 继续沿用当前的首次访问渲染与后续保活策略

### App.vue 责任

`App.vue` 只负责：

- 左侧导航注册
- 激活 panel 切换
- 新 panel 的挂载与显示控制

`App.vue` 不负责：

- controller 命令拼装
- controller 日志管理
- controller 业务区的内部交互

这些状态全部应收口在 `InjectControllerPanel.vue` 内部。

首版 `Controller` panel 不接收 `commandLoading` prop，也不发出 `command-loading-change` 事件，因为本轮没有任何真实命令会跨 panel 占用共享执行锁。

`Controller` panel 首版应作为共享 agent runtime 的只读消费者：

- 可以读取 `useAutoOperationAgentSwitch()` 暴露的可用性、连接态和状态文案
- 不负责 `loadAgent()` / `unloadAgent()` / `toggleAgent()`
- 不自己再次执行 `Ping`，避免和共享 runtime 重复维护另一份状态

### 测试定位约定

为保持当前 `Inject` 测试风格一致，新增 panel 需要显式提供 `data-testid`。

建议约定：

- 左侧导航按钮：`inject-tab-controller`
- panel 容器：`inject-panel-controller`
- 状态卡片：
  - `controller-status-desktop`
  - `controller-status-agentBridge`
  - `controller-status-agentConnection`
  - `controller-status-transport`
- 命令名输入框：`controller-command-input`
- JSON 参数输入区：`controller-args-input`
- 发送按钮：`controller-send-button`
- 未接入提示：`controller-transport-not-ready`
- 响应区空态：`controller-response-log`
- 业务分区：
  - `controller-domain-character-scene`
  - `controller-domain-movement-interaction`
  - `controller-domain-inventory-warehouse`
  - `controller-domain-trading-market`

## Controller Panel 页面结构

`Controller` panel 首版建议按自上而下的三段结构组织。

### 1. 头部说明区

展示：

- 标题：走 i18n 的 `inject.controllerTitle`
- 副标题：走 i18n 的 `inject.controllerSubtitle`

目的：

- 与现有 `Agent 状态` panel 的“注入/诊断”语义拉开距离
- 向用户明确这是一块未来能力入口，而不是当前已完整可用的业务台

### 2. 连接与 Controller 命令区

这一段分成两部分。

#### 只读状态卡片

首版显示四项状态：

- `桌面环境`
- `Agent 桥接可用性`
- `Agent 当前状态`
- `Controller 通道状态`

其中：

- `桌面环境` 可基于 `window.bidkingDesktop?.isDesktop` 判断
- `Agent 桥接可用性` 可基于现有 `startAutoOperationAgent` / `runAutoOperationCommand` 能力是否存在判断
- `Agent 当前状态` 必须直接读取共享 `useAutoOperationAgentSwitch()` runtime 的 `isConnected` / `statusText`
  - 不能自己重新 `Ping`
  - 不能只根据 bridge 能力是否存在来推断
- `Controller 通道状态` 首版固定表达为“未接入”或等价文案

#### Controller 命令骨架

包含：

- `命令名` 输入框
- `JSON 参数` 文本域
- `发送` 按钮
- `响应日志` 空态区

本区块的关键约束：

- 首版 `发送` 按钮必须处于 disabled 状态
- `发送` 按钮旁必须始终显示一条醒目的内联提示，不得藏在 tooltip 中
  - 推荐文案：`Controller 通道尚未接入，本区仅预留交互形态`
- `响应日志` 首版不展示可清空的动态日志列表，只展示固定空态说明
  - 推荐文案：`Controller 通道接入后将在这里显示响应`
- 不允许做本地 mock 成功返回
- 不允许偷偷复用 `runAutoOperationCommand` 去伪造 controller 已经存在

这一段虽然保留“命令名 + JSON 参数 + 发送按钮 + 响应区”的结构，但它的语义必须明确限定为：

- 面向未来 `controller bridge` 的高层意图命令壳层
- 不是 `AutoOperation` 原始命令台的第二份拷贝
- 不是 `class/method/arg0` 风格的底层调试入口

因此后续这里承接的应是 controller 级命令名与 payload，而不是把 `InjectAgentPanel` 里那组底层 `AutoOperation` 命令按钮再搬一遍。

保留这套输入骨架的原因是：这轮已经明确选定了未来 controller 命令的基本交互形态，因此首版需要把结构先钉死；但通过 disabled 发送按钮和常驻提示，避免把它误读成“只差一步就能用”的假实现。

### 3. 业务操作骨架区

首版只放 4 个静态业务分区卡片：

- `角色 / 场景`
- `移动 / 交互`
- `背包 / 仓库`
- `交易 / 市场`

每个分区只包含：

- 分区标题
- 一句用途说明

首版不放：

- 假按钮
- 假表单
- disabled 的具体操作项

这样可以先把未来信息架构定下来，同时避免占位 UI 反向绑定后续真实协议设计。

## 状态模型

`InjectControllerPanel.vue` 首版只需要维护轻量本地状态：

- `commandName`
- `commandArgsText`
- `desktopReady`
- `agentBridgeAvailable`
- `controllerTransportReady`

状态语义如下：

- `desktopReady`
  - 当前是否在桌面桥接环境下运行
  - 由 `InjectControllerPanel.vue` 在自身 `setup/onMounted` 中直接基于 `window.bidkingDesktop?.isDesktop` 推导
  - 不由 `App.vue` 代算或下发
- `agentBridgeAvailable`
  - 当前是否存在已知 agent 相关桥接能力
  - 同样由 `InjectControllerPanel.vue` 本地判断是否存在 `startAutoOperationAgent` / `runAutoOperationCommand`
- `agentConnected`
  - 不作为本地自管状态保存
  - 直接消费共享 `useAutoOperationAgentSwitch()` runtime 的 `isConnected`
  - 用于让 `Controller` 与 TopBar / `Agent 状态` panel 呈现一致的 agent 当前状态
- `controllerTransportReady`
  - 当前 controller 通道是否可实际发送命令
  - 首版固定为 `false`

首版不需要维护 `controllerLogLines`，因为：

- 没有真实 transport
- `发送` 按钮不可触发
- `响应日志` 区域只呈现固定空态说明

等后续接入真实 controller bridge 时，再引入日志数组和清空行为。

## 职责边界

### InjectAgentPanel 继续负责

- agent 注入与连通性状态
- 命名管道与底层命令诊断
- 现有 `AutoOperation` 命令调用
- 结果即时展示

### InjectControllerPanel 首版负责

- controller 工作台的独立入口
- 状态占位与就绪状态呈现
- controller 级命令区的交互壳层
- 未来业务操作区的信息架构骨架

### 明确不做的事

`InjectControllerPanel` 首版不负责：

- 注入 agent
- 替代现有 `Agent 状态` panel
- 直接执行现有 `AutoOperation` 原始命令
- 实现 controller 协议本身
- 复制 `InjectAgentPanel` 的底层命令调试台

## 未来扩展约束

后续如果接入真实 controller 通信，建议新增独立桥接语义，例如：

```js
window.bidkingDesktop.runControllerCommand(name, payload)
```

而不是继续复用：

```js
window.bidkingDesktop.runAutoOperationCommand(command, args)
```

原因：

- `AutoOperation` 更偏底层 agent 命令
- `Controller` 更偏高层业务意图
- 两者长期复用同一套协议会导致语义边界混乱

因此本次设计把 `Controller` panel 的 UI 先独立出来，就是为了给后续单独的 controller bridge 留出清晰落点。

## 交互原则

### 原则 1: 不伪装为已接通

首版必须让用户一眼能看出：

- panel 已存在
- 结构已确定
- 但 controller 通道尚未接入

这比做一个“看起来能发命令、实际只是本地假回包”的半成品更可靠。

### 原则 2: 不提前绑定未来具体操作形态

业务操作区只定义一级分区，不定义具体按钮和表单。

这样后续可以根据真实 controller 协议和游戏内操作语义，自然决定：

- 是按钮型
- 表单型
- 向导型
- 还是混合操作台

### 原则 3: 保持与现有 Inject workspace 一致

新 panel 必须遵循当前 `Inject` 的工作台模式：

- 左侧导航切换
- 首次访问挂载
- 后续切换保留实例
- 不引入新的跨路由持久化

## 测试策略

### 页级测试

更新 `src/inject/App.test.js`，覆盖：

- `基础` 分组中新增 `Controller` 导航项
- 点击 `Controller` 后能切换到新 panel
- 现有 panel 切换逻辑不回归
- 新 panel 同样遵循首次访问挂载、后续保活的模式
- `Controller` panel 显示的 agent 当前状态与共享 runtime 一致

### Panel 级测试

新增 `src/inject/panels/InjectControllerPanel.test.js`，覆盖：

- 标题与说明文案渲染
- readiness 状态渲染
- `Agent 当前状态` 来源于共享 `useAutoOperationAgentSwitch()` runtime，而不是本地硬编码
- `发送` 按钮在首版默认 disabled
- “controller 通道尚未接入”类提示存在
- 响应区空态存在
- 四个业务分区骨架存在
- `data-testid` 命名与 spec 约定一致

### 本轮不需要新增的测试

本轮不需要新增：

- preload 测试
- electron main / service 测试
- agent 通信测试

原因是本轮设计明确不接入真实 controller 协议。

## 风险与控制

### 风险 1: 用户误以为 Controller 已可用

控制策略：

- 标题、副标题、状态卡片和命令区提示都必须明确“未接入”
- `发送` 按钮默认禁用

### 风险 2: 与 Agent 状态 panel 职责重叠

控制策略：

- 不在 `Controller` 中复制现有 `AutoOperation` 命令按钮
- 不在 `Controller` 中承担 agent 注入和 ping 诊断
- 将命令骨架明确限定为未来 controller 级命令，而不是第二套底层 RPC 调试台

### 风险 3: 首版骨架把未来交互做死

控制策略：

- 业务区只保留一级分区
- 不提前放具体操作控件

## 验收标准

满足以下条件时，本设计对应的实现可判定完成：

- `Inject` 左侧 `基础` 分组下已新增 `Controller`
- `Controller` 作为独立 panel 接入现有 workspace shell
- panel 内已包含：
  - 头部说明区
  - 连接与 `Controller` 命令区
  - 业务操作骨架区
- `Controller` 面板展示的 agent 当前状态与共享 `useAutoOperationAgentSwitch()` runtime 一致，不与 TopBar / `Agent 状态` panel 冲突
- 首版 `发送` 按钮默认 disabled，且明确提示 controller 通道未接入
- `Controller` 与 `Agent 状态` 的职责边界在代码和文案层都清晰可见
- 对应页级测试和 panel 级测试已补齐
- `docs/Documentation.md` 与 `docs/ARCHITECTURE.md` 已在同轮同步更新当前 Inject panel 清单与信息架构
