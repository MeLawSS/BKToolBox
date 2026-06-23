# AutoAuction Fixed Waits Optimization Design

**Date:** 2026-06-23  
**Scope:** `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` 中的 `CmdAutoAuction`  
**Goal:** 在不扩展到其他聚合流程的前提下，移除 `CmdAutoAuction` 中以固定 `SleepInterruptibly(...)` 为主的等待方式，改为“状态达成即继续”的轮询等待，以缩短正常路径耗时，并尽量保持当前业务流程和成功率。

## Context

当前 `CmdAutoAuction` 共有 8 个步骤，包含 31 处固定时间等待。除了 `WaitForBidConfirmationSettled(...)` 已经使用状态轮询外，其余等待大多属于以下几类：

- 点击按钮后固定等待 `1500ms` / `2000ms`
- 等待屏幕切换前先固定等待 `1000ms`
- 等待出价弹窗、toggle、输入框状态稳定时固定等待 `300ms` / `500ms`
- cleanup 阶段在按钮未就绪或点击后反复固定等待

代码库中已经存在两类正确范式：

- `CmdWaitForNode`：轮询节点是否达到 `exists/active/interactive`
- `WaitForBidConfirmationSettled`：轮询对话框出现、消失和二次确认状态

问题不在于缺少轮询能力，而在于 `CmdAutoAuction` 仍然把“点击”和“固定等待”耦合在一起，尤其是当前的 `clickOnPanel(..., delayMs)` helper。

## Constraints

- 本轮只覆盖 `CmdAutoAuction`
- 不扩展到 `CollectCabinetReward` 或其他聚合流程
- 允许在 `CmdAutoAuction` 内新增文件内 helper，并允许调整其对外失败语义
- 不把 `CmdAutoAuction` 改造成跨文件的大状态机
- `authcode_required`、`room_entry_limit_reached`、`canceled`、`auction_ended` 这些业务终态需要保持兼容
- 正常路径提速优先，但不能以明显牺牲常见成功路径稳定性为代价

## Approaches Considered

### Approach A: 逐处原地替换固定等待

把每个 `SleepInterruptibly(...)` 直接替换成对应轮询，不改 `CmdAutoAuction` 结构。

优点：

- 改动最小
- 回归面最窄

缺点：

- 等待逻辑仍然分散
- 超时、错误语义、日志无法统一
- 后续继续优化时仍会重复修改同一函数

### Approach B: 仅在 `CmdAutoAuction` 内收敛等待原语

保留当前 8 个业务阶段，但把等待语义收敛成少量文件内 helper，例如：

- 等待目标屏幕出现
- 等待离开当前屏幕
- 等待节点 ready
- 等待节点状态变化
- 点击后等待明确结果

优点：

- 可以显著减少正常路径无意义等待
- 不把改动扩散到本轮范围之外
- 可统一超时预算、轮询间隔、错误码和日志语义

缺点：

- 比逐处替换多一层内部结构调整

### Approach C: 重写为完整显式状态机

把整个 `CmdAutoAuction` 重写为完整状态机，每个状态显式定义进入条件、退出条件、超时和恢复策略。

优点：

- 长期结构最清晰
- 最利于后续扩展和调试

缺点：

- 首轮改动面过大
- 超出本轮“只覆盖 `CmdAutoAuction` 且速度优先”的必要范围

## Decision

采用 **Approach B**。

本轮不追求一次性把 `CmdAutoAuction` 升级成全局通用状态机，而是在函数内部建立统一等待语义，使每一步从“固定睡多久再看”变成“目标状态出现就立即推进，直到超时才失败”。

## Design Overview

`CmdAutoAuction` 继续保留当前 8 个业务阶段，但主流程不再直接依赖固定时长作为等待完成条件。设计上的核心变化有两点：

1. `SleepInterruptibly(...)` 只允许承担轮询间隔或极短稳定窗口，不再承担点击后的主等待职责
2. 点击动作与后续目标状态绑定，点击成功但目标状态未变化时，不视为该步骤完成

额外约束：

- “观察轮询更快”不等于“同一轮出价重试更快”
- bid loop 必须把“状态观察频率”和“实际点击出价频率”分离，避免因为缩短观察轮询而在同一轮内高频重复点击

### Wait Semantics

本轮把等待语义收敛为 5 类：

1. `WaitForScreen`
   - 轮询 `DetectScreenState()`
   - 成功条件是目标屏幕或目标谓词满足

2. `WaitForScreenTransition`
   - 轮询直到离开旧屏幕，或进入指定新屏幕
   - 适用于点击后等待场景切换

3. `WaitForNodeReady`
   - 轮询节点达到 `active` / `interactive`
   - 判定语义与现有 `WaitForNode` 保持一致

4. `WaitForNodeStateChange`
   - 轮询节点文本、toggle 或是否存在等状态变化
   - 适用于出价弹窗内部交互

5. `ClickAndWait`
   - 点击成功后继续等待明确的完成条件
   - 取代现在的 `clickOnPanel(..., delayMs)`

这些 helper 只在 `MetaOperations.cpp` 内部定义和使用，不作为新的对外命令或共享框架抽象。

## Stage-by-Stage Behavior

### Step 1: Recover to `main_lobby`

当前问题：

- 每次尝试关闭浮层后固定等待 `1500ms`
- 即使关闭动作立刻生效也会继续硬等

改造后：

- 每轮先 `DetectScreenState()`
- 若已经是 `main_lobby`，立即结束该阶段
- 若 `ResolveCloseTarget(...)` 返回可关闭目标，则点击后轮询：
  - 当前屏幕是否已经变化
  - 当前待关闭目标是否已消失
- 若本轮没有可关闭目标，则继续下一轮状态判定
- 仍保留总预算，超时返回阶段化失败

### Step 2: Enter `auction_lobby_map`

当前问题：

- `GoToBattlePrev` 点击后固定等待 `1500ms`
- 随后循环中每次“先睡 1000ms 再检测”

改造后：

- 点击 `UIMain/MainPanel/mask/Button`
- 立即进入 `WaitForScreen(screen == "auction_lobby_map")`
- 每轮轮询同时保留 `authcode` 检测

### Step 3: Enter `auction_lobby_room`

当前问题：

- 点击房间入口后固定等待 `2000ms`
- 等待房间屏幕时继续使用“先睡再检”

改造后：

- 点击 `Panel_1/bg/MapContainer/MapItem_<roomId>/Image (1)`
- 立即轮询直到 `auction_lobby_room`
- 保留现有房间日次数上限检测逻辑

### Step 4: Skill Config, Hero Select, Start Action

当前问题：

- 打开技能配置、选角色、开始战斗都用固定等待
- 没有显式判断“下一步 UI 是否真的 ready”

改造后：

- 点击技能配置后，等待角色节点 ready
- 点击角色后，等待“开始战斗”按钮 ready 或角色选择 UI 收敛
- 点击开始战斗后，不再固定等待 `2000ms`
- 点击开始战斗后的短轮询只用于避免立刻读取到旧状态，不引入新的独立硬失败边界
- 等待正式进入 `auction_in_progress` 或提前进入 `auction_ended` 的长预算，仍完全由 Step 5 承担

### Step 5: Wait for `auction_in_progress`

当前问题：

- 最长预算足够，但轮询粒度过粗，正常路径经常多等
- `DetectScreenState()` 不是轻量 predicate，长时间高频调用会显著放大 UI 扫描成本

改造后：

- 保留约 `120s` 的总预算
- 不与短 UI 切换共用同一档 `100ms` 轮询
- 使用 **分段 / 退避轮询**：
  - 开始战斗后的极短观察窗口允许更快轮询，用于尽早捕获“立刻进入拍卖”或“立刻进入结束画面”的快路径
  - 如果未快速进入目标状态，则必须退避到更粗的轮询档位，避免在长达 `120s` 的等待中持续高频调用 `DetectScreenState()`
- 长等待阶段的稳态轮询频率不得比当前实现显著更激进；本轮设计目标是减少固定等待，不是把它替换成持续高频探测
- 目标状态一出现立即推进
- 若提前进入 `auction_ended`，继续保持当前业务语义并立刻返回

### Step 6: Bid Loop

这是本轮提速收益最大的阶段。

当前问题：

- 每轮循环开头固定等待 `1000ms`
- 点击“出价”后固定等待 `1500ms`
- 关闭 `priceUpperLimit` 后固定等待 `300ms`
- 写入金额后固定等待 `500ms`

改造后：

- 去掉每轮固定 `1000ms`，改为短轮询读取当前 `screen`、`round`、`secs`
- 引入显式的 **per-round retry policy**，把“是否继续观察当前轮”和“是否允许再次点击 `Gaming/chujia`”分开
- 至少需要跟踪当前轮最近一次出价尝试的轮次和时间；在同一轮内，即使 `lastBidRound` 尚未推进，也不得按 `50ms` 到 `100ms` 频率反复点击
- 默认同轮重试冷却不得短于当前实现隐含提供的 `1000ms` 节流；只有轮次变化，或明确进入了下一阶段的 dialog state，才允许更快推进
- 对第 2 到第 5 轮的对手限价逻辑，必须给玩家名和上一轮出价 UI 一个有界的 settle 窗口；不能因为观察轮询变快而立刻用未稳定数据反复读、反复点
- 如果同轮第一次尝试前，对手名或上一轮出价在 settle 窗口内仍未稳定，本轮应按现有 fallback 语义记录原因并继续走一次受节流保护的尝试，而不是高频重试读取
- 点击 `Gaming/chujia` 后，等待出价输入框真正出现
- 关闭 `priceUpperLimit` 后，等待 toggle 状态实际变为 `off`
- 写入金额后，等待输入框文本已同步，或确认按钮进入可继续状态
- 最终确认继续以 `WaitForBidConfirmationSettled(...)` 为主收敛点，但 AutoAuction 在这一阶段不能保留一个不检测 `authcode` 的盲等窗口

`WaitForBidConfirmationSettled(...)` 仍是正确的确认收敛范式，但本轮需要额外满足一条约束：确认阶段也必须能够及时返回 `authcode_required`。实现上可以是扩展该 helper 自身检测 `authcode`，也可以在 `CmdAutoAuction` 中增加只服务此流程的 authcode-aware 包装层；本 spec 不要求把它抽成共享框架。

### Step 7: Winner Detection and Quick Recycle

当前问题：

- 还没读到胜者名、按钮未出现、点击后都使用 `1000ms` / `1500ms` 固定等待

改造后：

- 短轮询胜者名称是否可读取
- 若自己胜出，则继续短轮询 `PanelBattleHuiShouTran/huishou` 是否 ready
- 点击快捷回收后，等待按钮消失或结束画面进入下一可恢复状态

### Step 8: Cleanup Back to `main_lobby`

当前问题：

- `receiveBtn/continueBtn` 点击后固定等待 `1500ms`
- `Top/Close` 点击后固定等待 `1500ms`
- 整体 cleanup 仍是“尝试 -> 固定睡眠 -> 再看”

改造后：

- 点 `receiveBtn/continueBtn` 后，等待离开 `auction_ended`
- 点 `Top/Close` 后，等待离开 `auction_lobby_map` / `auction_lobby_room`
- cleanup 成功条件继续是最终回到 `main_lobby`

## Timeouts and Polling Policy

原则：

- 总预算尽量不缩，避免异常路径更脆
- 轮询粒度明显缩短，确保正常路径更快

建议预算：

- Step 1 回 `main_lobby`：约 `15s`
- Step 2 等 `auction_lobby_map`：`15s`
- Step 3 等 `auction_lobby_room`：`15s`
- Step 4
  - 打开技能配置到角色节点 ready：`3s`
  - 角色选择收敛到开始按钮 ready：`3s`
  - 点击开始战斗后的短过渡观察：仅允许作为非独立失败边界的短窗口
- Step 5 等 `auction_in_progress`：`120s`
  - 这 `120s` 预算继续覆盖开始战斗后的长等待，以及提前进入 `auction_ended` 的情况
  - 轮询策略必须分段或退避，而不是全程 `100ms`
- Step 6
  - 出价输入框出现：`1.5s`
  - `priceUpperLimit` 状态切换完成：`0.6s`
  - 输入框文本稳定：`0.6s`
  - 确认收敛：沿用 `WaitForBidConfirmationSettled(...)` 的 `3s`
  - 同轮点击重试冷却：不得短于 `1000ms`
- Step 7：保留当前约 `30s` 的窗口
- Step 8：保留当前 cleanup 总预算量级，不在首轮激进收缩

建议轮询间隔：

- 短屏幕切换：`100ms`
- Step 5 这类长屏幕等待：
  - 初始快路径观察窗口：`100ms` 到 `200ms`
  - 若超过该窗口仍未进入目标状态，退避到 `500ms`
  - 在持续长等待阶段，允许进一步退避到 `1000ms` 到 `1500ms`
- 节点 ready / 状态变化：`50ms` 到 `100ms`
- cleanup / 胜者文本：`100ms` 到 `200ms`

## Response and Error Semantics

本轮允许对失败语义做收敛，但不改动已有业务成功终态。

### Kept Business Results

继续保留 `ok=true` 的业务结果：

- `auction_ended`
- `authcode_required`
- `room_entry_limit_reached`
- `canceled`

### Failure Semantics

继续保留 `ok=false` 表示真正失败，但失败字符串从自由文本收敛成稳定阶段码。

本轮设计对这些阶段码的收益边界要写清楚：

- 直接收益：native log、CLI 输出、以及 Electron bridge 当前抛出的 `Error.message` 会更稳定、更可检索
- 非目标：本轮不承诺 renderer 或 Elsa 对这些 `ok=false` 失败做新的结构化分支处理
- 如果未来需要基于阶段码做 UI 级差异化处理，应作为后续单独消费者改造和测试任务

建议格式：

- `auto_auction_timeout:wait_main_lobby`
- `auto_auction_timeout:wait_lobby_map`
- `auto_auction_timeout:wait_lobby_room`
- `auto_auction_timeout:wait_skill_config`
- `auto_auction_timeout:wait_bid_dialog`
- `auto_auction_timeout:wait_cleanup_transition`
- `auto_auction_ui_error:<stage>`
- `auto_auction_unexpected_screen:<screen>`

设计要求：

- 失败字符串必须稳定、可机器识别
- 详细调试上下文继续写 native log，不塞进对外 error 字符串
- 现有 `BuildAutoAuctionAuthCodeRequiredResult(...)`、`BuildAutoAuctionRoomEntryLimitReachedResult(...)` 继续保留

## Internal Structure

`CmdAutoAuction` 继续承担业务编排，但不再直接散落地写固定等待。

建议新增的文件内 helper 方向：

- `WaitForAutoAuctionScreen(...)`
- `WaitForAutoAuctionScreenTransition(...)`
- `WaitForAutoAuctionNodeReady(...)`
- `WaitForAutoAuctionToggleState(...)`
- `WaitForAutoAuctionInputText(...)`
- `ClickAutoAuctionNodeAndWait(...)`

这些 helper 需要统一遵守：

- 每轮轮询都检查 `stopIfRequested()`
- 每轮轮询都保留 `authcode` 检测能力
- 这条要求同样覆盖最终确认阶段；如果 `WaitForBidConfirmationSettled(...)` 保持通用实现，则 AutoAuction 侧必须用额外包装补齐
- 只返回本轮需要的最小状态，不引入新的全局状态机容器

## Testing and Verification

### Pure Logic / Unit-Level

继续使用当前原生测试文件：

- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

新增测试重点：

- 新阶段化错误码格式
- `AutoAuction` 业务结果格式保持兼容
- 新增等待 helper 中可抽成纯语义函数的部分
- 同轮点击节流 / 重试策略对应的纯语义函数
- 确认阶段 `authcode` 早返回对应的纯语义分支

当前 `src/elsa/useElsaAutoOperation.test.js` 不被要求在本轮新增 `ok=false` 结构化分支覆盖，因为本 spec 不承诺消费者行为变化；如果后续要让 Elsa 或其他 renderer 基于阶段码做差异化处理，必须把那部分测试作为后续任务补齐。

不要求把整段 `CmdAutoAuction` 直接做成单元测试。

### Manual / Integration Verification

至少验证以下路径：

1. 从 `main_lobby` 启动，确认能更快进入 `auction_lobby_map`
2. 正常进入房间并进入 `auction_lobby_room`
3. 技能配置、角色选择、开始战斗在 UI 较快出现时不再额外硬等
4. 房间已满直接进入 `auction_ended` 时，能更早返回
5. 出价弹窗出现后，不再依赖 `1500 + 300 + 500ms` 固定等待
6. 快捷回收路径在“自己胜出”和“自己未胜出”两条路径都正确
7. cleanup 能稳定回到 `main_lobby`
8. `CancelAutoAuction` 在长等待阶段触发时，仍能快速中断
9. `authcode` 在导航、开战等待、出价循环和 cleanup 中仍能及时返回 `authcode_required`
10. 同一轮在确认未完成时，不会因为 `50ms` 到 `100ms` 观察轮询而高频重复点击 `Gaming/chujia`
11. 一个 native `ok=false` 阶段码能通过当前 bridge 以稳定的错误消息形式暴露出来
12. Step 5 长等待不会把 `DetectScreenState()` 提升为全程 `100ms` 级高频扫描

## Acceptance Criteria

完成标准：

- `CmdAutoAuction` 业务步骤中，不再依赖固定 `1000ms`、`1500ms`、`2000ms` 作为主等待手段
- 目标状态提前出现时，流程必须提前推进
- 观察轮询和同轮出价点击频率已明确分离；缩短观察轮询后，同轮点击节流不短于当前 `1000ms` 基线
- 开始战斗后的长等待仍归 Step 5 的现有预算负责，不新增比当前更严格的独立失败边界
- Step 5 的长等待采用分段或退避轮询；快路径可更快，长路径不能退化成持续高频 `DetectScreenState()` 扫描
- `WaitForBidConfirmationSettled(...)` 继续作为确认阶段主收敛点，但该阶段不能成为 `authcode` 检测盲区
- 现有业务终态结果保持兼容
- 技术失败能定位到具体阶段，而不是只返回模糊自由文本；本轮保证的是更稳定的错误字符串和日志，不包含新的 renderer 结构化分支行为
- 本轮只修改 `CmdAutoAuction` 及其直接相关内部 helper，不扩散到其他聚合流程

## Out of Scope

- 重构 `CollectCabinetReward`
- 引入跨文件通用等待框架
- 把整个 `CmdAutoAuction` 重写为完整状态机
- 修改 Electron bridge timeout 策略
- 修改 `AutoAuction` 的业务出价策略、房间策略或 UI 暴露面
