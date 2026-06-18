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
  - 通用命令区的交互骨架
  - 未来业务操作区的分区骨架
- 明确区分 `Controller` 与现有 `Agent 状态` panel 的职责

## 范围

- 更新 `Inject` 左侧导航，在 `基础` 分组下新增 `Controller`
- 新增独立 `InjectControllerPanel` 组件
- 为 `Controller` panel 增加首版本地状态模型
- 增加中英文 i18n 文案
- 补齐 panel 级和页级测试，覆盖导航接入和壳层行为

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
- `Controller`

其中 `Controller` 放在 `Agent 状态` 后面，表达“它依赖 agent 能力，但职责更偏上层操作编排”。

本次设计建议在中英文文案里都直接使用 `Controller` 作为导航标签，避免在首版阶段引入含义不稳定的中文翻译。

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

## Controller Panel 页面结构

`Controller` panel 首版建议按自上而下的三段结构组织。

### 1. 头部说明区

展示：

- 标题：`Controller`
- 副标题：明确这是“未来通过 controller 与 injected agent 通信、执行游戏内操作”的工作台

目的：

- 与现有 `Agent 状态` panel 的“注入/诊断”语义拉开距离
- 向用户明确这是一块未来能力入口，而不是当前已完整可用的业务台

### 2. 连接与通用命令区

这一段分成两部分。

#### 只读状态卡片

首版显示三项状态：

- `桌面环境`
- `Agent API 可用性`
- `Controller 通道状态`

其中：

- `桌面环境` 可基于 `window.bidkingDesktop?.isDesktop` 判断
- `Agent API 可用性` 可基于现有 `startAutoOperationAgent` / `runAutoOperationCommand` 能力是否存在判断
- `Controller 通道状态` 首版固定表达为“未接入”或等价文案

#### 通用命令骨架

包含：

- `命令名` 输入框
- `JSON 参数` 文本域
- `发送` 按钮
- `清空日志` 按钮
- `响应日志` 区域

本区块的关键约束：

- 首版 `发送` 按钮必须处于 disabled 状态
- 必须在区块内明确提示“controller 通道尚未接入，本区仅预留交互形态”
- 不允许做本地 mock 成功返回
- 不允许偷偷复用 `runAutoOperationCommand` 去伪造 controller 已经存在

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
- `controllerLogLines`
- `desktopReady`
- `agentApiAvailable`
- `controllerTransportReady`

状态语义如下：

- `desktopReady`
  - 当前是否在桌面桥接环境下运行
- `agentApiAvailable`
  - 当前是否存在已知 agent 相关桥接能力
- `controllerTransportReady`
  - 当前 controller 通道是否可实际发送命令
  - 首版固定为 `false`
- `controllerLogLines`
  - 面板内临时日志
  - 不持久化，不跨页面共享

## 职责边界

### InjectAgentPanel 继续负责

- agent 注入与连通性状态
- 命名管道与底层命令诊断
- 现有 `AutoOperation` 命令调用
- 结果即时展示

### InjectControllerPanel 首版负责

- controller 工作台的独立入口
- 状态占位与就绪状态呈现
- 通用命令区的交互壳层
- 未来业务操作区的信息架构骨架

### 明确不做的事

`InjectControllerPanel` 首版不负责：

- 注入 agent
- 替代现有 `Agent 状态` panel
- 直接执行现有 `AutoOperation` 原始命令
- 实现 controller 协议本身

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

### Panel 级测试

新增 `src/inject/panels/InjectControllerPanel.test.js`，覆盖：

- 标题与说明文案渲染
- readiness 状态渲染
- `发送` 按钮在首版默认 disabled
- “controller 通道尚未接入”类提示存在
- `清空日志` 按钮行为
- 四个业务分区骨架存在

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
  - 连接与通用命令区
  - 业务操作骨架区
- 首版 `发送` 按钮默认 disabled，且明确提示 controller 通道未接入
- `Controller` 与 `Agent 状态` 的职责边界在代码和文案层都清晰可见
- 对应页级测试和 panel 级测试已补齐
