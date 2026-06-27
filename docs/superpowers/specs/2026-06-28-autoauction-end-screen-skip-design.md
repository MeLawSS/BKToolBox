# AutoAuction End-Screen Skip-Reveal Design

**Date:** 2026-06-28  
**Scope:** `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` 中 `CmdAutoAuction` 对局结束后的 ended-screen cleanup tail（现有 Step 7 + Step 8）  
**Goal:** 当 `AutoAuction` 已进入对局结束页、且当前 cleanup 子阶段还没有可执行的下一步动作时，自动点击结束页背景以跳过战利品逐件揭露动画，并在下一步动作一出现后立即继续现有 cleanup 流程。

## Current Facts

1. `DetectScreenState()` 已经把 `Battle_Main/EndPanel` 激活状态识别为 `auction_ended`。
2. `ResolveCloseTarget(...)` 对 `auction_ended` 的通用关闭路径已经是 `EndPanel/bg`，说明“点背景关闭/推进结束页”这条点击路径已被当前仓库接受。
3. `CmdAutoAuction` 的 Step 7 ended-screen prelude 最长会在 `auction_ended` 内停留约 `30s`，主要等待两类东西之一：
   - 胜者文本稳定，确定是否需要快捷回收
   - 自己胜出时 `PanelBattleHuiShouTran/huishou` 变为 ready
4. `CmdAutoAuction` 的 Step 8 cleanup 流程已经在 `auction_ended` 分支里等待两个主动作按钮之一变为 ready：
   - `EndPanel/tuichu/receiveBtn`
   - `EndPanel/tuichu/continueBtn`
5. 当前 Step 7 和 Step 8 的 ended-screen 路径都以“检测是否 ready，不 ready 就 `SleepInterruptibly(200)` 再重试”为主，没有主动跳过揭露动画。
6. 用户确认的目标行为是：
   - 先确认已经进入结束页
   - 再检测当前子阶段对应的下一步动作是否出现
   - 若未出现，则点击背景一次
   - 点击后等待 `300ms`
   - 循环直到期望按钮出现

## Problem

现在的 `AutoAuction` 在结束页战利品逐件揭露期间是被动等待的。由于阶段动作只有在揭露流程走完或推进到下一段后才会出现，ended-screen tail 会在 Step 7 和 Step 8 中多次空轮询，导致从对局结束到真正进入下一步动作之间存在明显额外等待。

问题不在于结束页无法关闭，而在于缺少一个“当前子阶段动作未 ready 时主动跳过揭露”的中间动作。

## Approaches Considered

### Approach A: 扩展通用 `WaitForNodeReady(...)`

给 `WaitForNodeReady(...)` 增加“未 ready 时执行补救点击”的回调或额外参数。

优点：

- 以后别的流程也能复用

缺点：

- 本次需求只服务 `auction_ended` cleanup，抽象会先于需求
- 会让通用 helper 承担过多场景特化逻辑

### Approach B: 在 `CmdAutoAuction` 的 ended-screen tail 内加入专用跳过循环

保持现有 Step 7 / Step 8 结构，只在 `auction_ended` 相关分支中，把“等当前动作 ready”改为“检测当前动作 ready，否则点背景跳过揭露并等待一个可观察的 `300ms` settle window”。

优点：

- 改动范围最小
- 与用户描述一一对应
- 不影响其他聚合流程和通用等待 helper

缺点：

- 这是一个 ended-screen 专用逻辑，不可直接复用到别的流程

## Decision

采用 **Approach B**。

这次需求不需要把 ended-screen 动画跳过抽象成新的通用等待框架。最稳妥的做法是在 `CmdAutoAuction` 对局结束后的 ended-screen tail 中，增加一个只服务该流程的专用 helper 或内联循环，并让它同时被 Step 7 和 Step 8 复用。

## Design

### Trigger Point

逻辑在 `CmdAutoAuction` 对局结束后的两个 ended-screen 子阶段中触发：

- Step 7：winner / quick-recycle prelude
- Step 8：exit-to-main_lobby cleanup

触发前提统一为：

1. 已确认当前 screen 仍是 `auction_ended`
2. 已有 `se.battleMainTransform`
3. 当前子阶段还没有可执行的下一步动作

这意味着背景跳过逻辑不再只放在 Step 8 `receiveBtn/continueBtn` 之前，而是也覆盖 Step 7 中以下等待点：

- 胜者文本尚未稳定
- 自己胜出，但 `PanelBattleHuiShouTran/huishou` 还没 ready

### Stage-Specific Ready Conditions

ended-screen 的“下一步动作 ready”改为按当前 cleanup 子阶段定义，而不是只看 Step 8 主按钮。

#### Step 7: Winner / Quick-Recycle Prelude

Step 7 的下一步动作 ready 条件：

1. 若胜者文本尚未稳定：
   - 视为“没有动作 ready”，允许尝试背景跳过
2. 若胜者文本已稳定且 `shouldWaitForQuickRecycle == false`：
   - 视为 Step 7 已可结束，立即离开 Step 7 进入 Step 8
3. 若胜者文本已稳定且 `shouldWaitForQuickRecycle == true`：
   - 只有 `PanelBattleHuiShouTran/huishou` ready 时，才视为动作 ready
   - 若该按钮尚未 ready，允许尝试背景跳过

#### Step 8: Ended-Screen Primary Action

Step 8 的 ready 条件保持现有逻辑：

- `IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/receiveBtn")`
- `IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/continueBtn")`
- 再交给 `PickAutoAuctionEndedPrimaryActionPath(...)`

只要当前子阶段的动作 ready，就立即退出跳过循环，继续当前 cleanup 主流程。

### Skip-Reveal Loop

当当前 screen 为 `auction_ended`，但当前子阶段的下一步动作尚未 ready 时，改为执行以下循环：

1. 再次确认仍未被取消、未进入 `authcode`、且 screen 仍为 `auction_ended`
2. 检测当前子阶段的下一步动作是否已经 ready
3. 若已 ready，立即返回当前主流程
4. 若未 ready，尝试点击 `EndPanel/bg`
5. 不论这次背景点击是否成功，只要未进入硬错误路径，都进入一个最长 `300ms` 的 settle poll window
6. 下一轮重新检测当前子阶段动作是否 ready

这个循环持续到以下任一条件成立：

- 当前子阶段动作 ready
- screen 不再是 `auction_ended`
- 检测到 `authcode`
- 收到 stop/cancel
- 达到当前子阶段的 wall-clock deadline

### Background Click Path

背景点击路径固定为：

- anchor: `se.battleMainTransform`
- path: `EndPanel/bg`

实现上直接复用现有 `ClickNode(...)`，不新增新的点击语义。

### Settle Window Semantics

本轮保留用户要求的 `300ms` 节奏，但不再把它实现成一段无观察的整块 sleep。

每次“当前动作未 ready -> 背景点击尝试”之后，进入一个 **最长 `300ms` 的 settle poll window**：

1. 总窗口长度目标仍为 `300ms`
2. 实现上把这 `300ms` 切成短 slice，例如 `50ms`
3. 每个 slice 之间都重新检查：
   - stop/cancel
   - `authcode`
   - 当前 screen 是否已经离开 `auction_ended`
   - 当前子阶段动作是否已经 ready
4. 如果在 `300ms` 内提前观察到 screen 变化、`authcode` 或动作 ready，则立即提前结束该窗口
5. 如果 `300ms` 结束仍无变化，才回到外层 ended-screen loop

这个 `300ms` 仍然是用户指定行为的一部分，但它必须是“可观察的 300ms”，不是新的 blind sleep。

它的职责是：

- 给结束页揭露动画一次推进窗口
- 避免在 ended-screen 上毫无间隔地高频点击背景
- 避免在 `300ms` 内错过 `authcode` 或 screen transition

### Failure and Stop Behavior

#### 1. 当前动作 ready

一旦 ready，流程回到当前子阶段原有动作：

- Step 7：
  - 若 `shouldWaitForQuickRecycle == false`，直接结束 Step 7
  - 若快捷回收按钮 ready，继续现有快捷回收点击逻辑
- Step 8：
  - 继续走 `ClickNode(se.battleMainTransform, endedActionPath, ...)`
  - 再执行现有 `WaitForScreenTransition("auction_ended", 3000, 150)`

#### 2. 背景点击失败

背景点击失败不直接视为整个 `AutoAuction` 失败。

理由：

- 揭露动画期间背景节点可能暂时不可点或不可交互
- 用户要求的是“尝试点一次背景，然后等 `300ms`，循环”
- 因此一次背景点击失败只应当算作本轮未成功跳过，而不是终止 cleanup

设计要求：

- 背景点击失败时记录 native log
- 仍然进入一个最长 `300ms` 的 settle poll window
- 然后进入下一轮动作 ready 检测

#### 3. Screen changed away from `auction_ended`

如果 ended-screen 跳过循环中发现 screen 已不再是 `auction_ended`，则退出该循环并回到当前子阶段外层 loop 重新判定 screen。

这保证：

- 若背景点击本身已经推动界面进入后续 screen，不会还卡在 ended-screen 子逻辑里
- 若未来 ended-screen 有新过渡态，也不会误把它当作按钮等待超时

#### 4. Authcode / cancel / unload

ended-screen 跳过循环必须继续遵守当前 `AutoAuction` 的中断语义：

- `authcode`：继续返回现有 `authcode_required`
- cancel / unload：继续返回现有 `canceled`

不允许在这段新循环里引入新的盲区，因此 `300ms` 等待窗口必须带 screen/authcode 观察。

### Timeout Ownership

本轮不新增新的对外 timeout 结果码，但会明确把 timeout ownership 改成 wall-clock deadline，而不是继续隐含依赖“attempt 数 × sleep 时长”。

#### Step 7 Deadline

当前 Step 7 预算是 `150` 次 × `200ms`，约 `30s`。

本轮要求：

- Step 7 改为显式 `deadline = startedAt + 30000ms`
- 是否点击背景、是否进入 `300ms` settle window，都不能让这个 `30s` 墙钟预算被拉长
- 如果进入 settle window，窗口长度必须按剩余预算裁剪为 `min(300ms, remainingBudget)`

#### Step 8 Deadline

当前 Step 8 预算是 `GetAutoAuctionCleanupMaxAttempts() == 200` 次 × `200ms`，约 `40s`。

本轮要求：

- Step 8 改为显式 `deadline = startedAt + 40000ms`
- 不能因为把 `200ms` 改成 `300ms` 就把墙钟预算隐式拉长到约 `60s`
- 如果进入 settle window，窗口长度必须按剩余预算裁剪为 `min(300ms, remainingBudget)`

#### External Error Semantics

ended-screen 跳过揭露逻辑仍然归属于当前 cleanup 阶段的既有错误语义：

- Step 7 若始终无法得到 winner / quick recycle 的可执行动作，继续保持该阶段现有失败边界
- Step 8 若 ended-screen 主动作始终不 ready，继续返回 `auto_auction_timeout:wait_cleanup_transition`
- ended-screen 主动作按钮点击失败并耗尽重试：继续返回 `auto_auction_ui_error:wait_cleanup_transition`

也就是说，这次需求只改变“动作未 ready 时的中间动作”和 deadline 表达方式，不改变 cleanup 对外阶段码。

## Implementation Shape

建议在 `MetaOperations.cpp` 内新增一个很小的文件内 helper，供 Step 7 和 Step 8 共同使用，形态类似：

- 输入：
  - 当前 `ScreenState`
  - 当前子阶段的“动作是否 ready”判定
  - 当前子阶段 deadline
- 输出：
  - 当前动作是否已经 ready
  - 若未 ready，内部已执行一次背景点击尝试并跑完一个最多 `300ms` 的 settle poll window
  - 若中途观察到 `authcode` / `screen change` / `stop` / `timeout`，能把结果显式返回给调用方

这个 helper 只服务 `CmdAutoAuction` ended-screen tail，不对外暴露，不进入 `AggregateOperationSemantics.h`。

建议职责：

1. 读取当前子阶段动作 ready 状态
2. 若 ready，立即返回
3. 若未 ready，尝试点击 `EndPanel/bg`
4. 记录 log
5. 在剩余 budget 内执行可观察的 `300ms` settle poll window
6. 返回“本轮未 ready，需要外层继续”

Step 7 / Step 8 外层 loop 继续负责：

- screen 检测
- stop/cancel 检测
- 子阶段 deadline ownership
- Step 7 的 winner / quick recycle编排
- Step 8 的主动作点击与后续 `WaitForScreenTransition(...)`

## Logging

为了便于后续观察效果，建议新增两类 native log：

1. ended-screen 当前动作未 ready，执行背景跳过：
   - 包含当前阶段是 Step 7 还是 Step 8
   - 包含当前 cleanup attempt 编号或等价序号
   - 包含剩余 budget 或 deadline 信息

2. 背景点击失败：
   - 包含当前阶段是 Step 7 还是 Step 8
   - 包含 cleanup attempt 编号或等价序号
   - 包含 `ClickNode(...)` 返回的错误字符串

3. 在 settle window 内提前观察到 screen 变化、`authcode` 或动作 ready：
   - 包含触发原因
   - 包含实际等待时长

不需要改变对外返回 JSON，只补 native log 即可。

## Testing and Verification

### Automated

这次逻辑主要落在 native `CmdAutoAuction` ended-screen tail，仓库当前没有直接覆盖整段 `CmdAutoAuction` 的 UI 仿真测试。

因此本轮 automated 验证重点不是强行补整段 aggregate 单测，而是：

- 保证现有仓库测试全部通过
- 不改动 `AggregateOperationSemantics.h` 现有 ended-screen 路径选择契约

### Manual

至少验证以下路径：

1. 对局正常结束后进入 `auction_ended`
2. 在 Step 7 中，若胜者文本或快捷回收按钮尚未 ready，agent 会尝试点击背景
3. 在 Step 8 中，若 `receiveBtn` / `continueBtn` 尚未 ready，agent 会尝试点击背景
4. 每次背景点击尝试后，会进入一个带 screen/authcode 观察的约 `300ms` settle window
5. 一旦当前子阶段动作 ready，agent 立即切回现有 cleanup 主流程
6. Step 7 和 Step 8 的墙钟预算仍分别保持在约 `30s` / `40s` 量级
7. cleanup 最终仍能回到既有完成 screen
8. 若中途出现 `authcode`，仍然立即返回 `authcode_required`

## Acceptance Criteria

- `AutoAuction` 已进入结束页后，不再只在 Step 8 被动轮询按钮，而是在整个 ended-screen tail 主动跳过揭露
- 当 Step 7 或 Step 8 的当前动作未 ready 时，会主动尝试点击 `EndPanel/bg`
- 每次背景点击尝试后，会进入一个最长 `300ms`、带 screen/authcode 观察的 settle poll window
- 一旦当前子阶段动作 ready，立即继续现有 cleanup 点击逻辑
- Step 7 / Step 8 的墙钟预算不会因为 `300ms` 节奏而被隐式拉长
- 不改变 `AutoAuction` 现有对外业务结果和 cleanup 阶段错误码
- 不扩展到其他非 `AutoAuction` 流程

## Non-Goals

- 不修改 `DetectScreenState()` 的 screen 分类
- 不把 ended-screen 背景点击做成通用 overlay close 框架
- 不改 `CloseCurrentOverlay`
- 不改 `AutoAuction` 出价逻辑、房间逻辑或 `authcode` 处理契约
- 不扩展到 `cabinet_reward_*` 或其他奖励界面
