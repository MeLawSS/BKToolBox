# AutoAuction End-Screen Skip-Reveal Design

**Date:** 2026-06-28  
**Scope:** `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` 中 `CmdAutoAuction` 的结束页 cleanup 阶段  
**Goal:** 当 `AutoAuction` 已进入对局结束页、但现有下一步主按钮尚未出现时，自动点击结束页背景以跳过战利品逐件揭露动画，并在按钮一出现后立即继续现有 cleanup 流程。

## Current Facts

1. `DetectScreenState()` 已经把 `Battle_Main/EndPanel` 激活状态识别为 `auction_ended`。
2. `ResolveCloseTarget(...)` 对 `auction_ended` 的通用关闭路径已经是 `EndPanel/bg`，说明“点背景关闭/推进结束页”这条点击路径已被当前仓库接受。
3. `CmdAutoAuction` 的 Step 8 cleanup 流程已经在 `auction_ended` 分支里等待两个主动作按钮之一变为 ready：
   - `EndPanel/tuichu/receiveBtn`
   - `EndPanel/tuichu/continueBtn`
4. 当前 Step 8 的 ended-screen 分支只是轮询这两个按钮是否 ready；当它们还没 ready 时，只会 `SleepInterruptibly(200)` 后继续重试。
5. 用户确认的目标行为是：
   - 先确认已经进入结束页
   - 再检测现有下一步按钮是否出现
   - 若未出现，则点击背景一次
   - 点击后等待 `300ms`
   - 循环直到期望按钮出现

## Problem

现在的 `AutoAuction` 在结束页战利品逐件揭露期间是被动等待的。由于按钮只有在揭露流程走完后才会出现，cleanup 会多次空轮询 `receiveBtn/continueBtn`，导致从对局结束到真正进入现有下一步动作之间存在明显额外等待。

问题不在于结束页无法关闭，而在于缺少一个“按钮未 ready 时主动跳过揭露”的中间动作。

## Approaches Considered

### Approach A: 扩展通用 `WaitForNodeReady(...)`

给 `WaitForNodeReady(...)` 增加“未 ready 时执行补救点击”的回调或额外参数。

优点：

- 以后别的流程也能复用

缺点：

- 本次需求只服务 `auction_ended` cleanup，抽象会先于需求
- 会让通用 helper 承担过多场景特化逻辑

### Approach B: 在 `CmdAutoAuction` ended-screen cleanup 内加入专用跳过循环

保持现有 cleanup 结构，只在 `auction_ended` 分支中，把“等按钮 ready”改为“检测按钮 ready，否则点背景跳过揭露并等待 `300ms`”。

优点：

- 改动范围最小
- 与用户描述一一对应
- 不影响其他聚合流程和通用等待 helper

缺点：

- 这是一个 ended-screen 专用逻辑，不可直接复用到别的流程

## Decision

采用 **Approach B**。

这次需求不需要把 ended-screen 动画跳过抽象成新的通用等待框架。最稳妥的做法是在 `CmdAutoAuction` Step 8 的 `auction_ended` 分支中，增加一个只服务该分支的专用 helper 或内联循环。

## Design

### Trigger Point

逻辑只在 `CmdAutoAuction` Step 8 cleanup 的 `IsAutoAuctionCleanupEndedScreen(se.screen)` 分支中触发。

更具体地说，触发位置在当前代码这一步之前：

- 读取 `receiveBtn` / `continueBtn` ready 状态
- 用 `PickAutoAuctionEndedPrimaryActionPath(...)` 决定点击哪个主动作按钮

也就是：

1. 已确认当前 screen 仍是 `auction_ended`
2. 已有 `se.battleMainTransform`
3. 正准备等待 ended-screen 主动作按钮出现

### Ready Condition

ended-screen 的“现有下一步按钮 ready”定义保持不变，继续使用当前逻辑：

- `IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/receiveBtn")`
- `IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/continueBtn")`
- 再交给 `PickAutoAuctionEndedPrimaryActionPath(...)`

只要任一主按钮 ready，就立即退出跳过循环，继续当前 cleanup 主流程。

### Skip-Reveal Loop

当当前 screen 为 `auction_ended`，但 `PickAutoAuctionEndedPrimaryActionPath(...)` 返回空时，改为执行以下循环：

1. 再次确认仍未被取消、未进入 `authcode`、且 screen 仍为 `auction_ended`
2. 检测 ended-screen 主按钮是否已经 ready
3. 若已 ready，立即返回当前主流程
4. 若未 ready，尝试点击 `EndPanel/bg`
5. 不论这次背景点击是否成功，只要未进入硬错误路径，都等待 `300ms`
6. 下一轮重新检测主按钮是否 ready

这个循环持续到以下任一条件成立：

- 主按钮 ready
- screen 不再是 `auction_ended`
- 检测到 `authcode`
- 收到 stop/cancel
- 达到 ended-screen cleanup 的既有超时预算

### Background Click Path

背景点击路径固定为：

- anchor: `se.battleMainTransform`
- path: `EndPanel/bg`

实现上直接复用现有 `ClickNode(...)`，不新增新的点击语义。

### Wait Semantics

本轮新增的等待语义只有一条：

- 每次“按钮未 ready -> 背景点击尝试”之后，等待 `300ms`

这个 `300ms` 是用户指定行为的一部分，不是新的长超时预算。

它的职责是：

- 给结束页揭露动画一次推进窗口
- 避免在 ended-screen 上毫无间隔地高频点击背景

### Failure and Stop Behavior

#### 1. 主按钮 ready

一旦 ready，行为与今天完全相同：

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
- 继续等待 `300ms`
- 然后进入下一轮按钮 ready 检测

#### 3. Screen changed away from `auction_ended`

如果 ended-screen 跳过循环中发现 screen 已不再是 `auction_ended`，则退出该循环并回到 Step 8 外层 cleanup 重新判定 screen。

这保证：

- 若背景点击本身已经推动界面进入后续 screen，不会还卡在 ended-screen 子逻辑里
- 若未来 ended-screen 有新过渡态，也不会误把它当作按钮等待超时

#### 4. Authcode / cancel / unload

ended-screen 跳过循环必须继续遵守当前 `AutoAuction` 的中断语义：

- `authcode`：继续返回现有 `authcode_required`
- cancel / unload：继续返回现有 `canceled`

不允许在这段新循环里引入新的盲区。

### Timeout Ownership

本轮不新增新的对外 timeout 结果码。

ended-screen 跳过揭露循环仍然归属于当前 Step 8 cleanup 的已有预算和错误语义：

- 按钮始终不 ready，且循环直到 cleanup 最后一次仍无进展：继续返回 `auto_auction_timeout:wait_cleanup_transition`
- ended-screen 主动作按钮点击失败并耗尽重试：继续返回 `auto_auction_ui_error:wait_cleanup_transition`

也就是说，这次需求只改变“按钮未 ready 时的中间动作”，不改变 Step 8 的对外阶段码。

## Implementation Shape

建议在 `MetaOperations.cpp` 内新增一个很小的文件内 helper，形态类似：

- 输入：`battleMainTransform`
- 输出：
  - 是否已拿到 `endedActionPath`
  - 若已拿到，对应主按钮路径
  - 若未拿到，内部已执行一次背景点击尝试并等待 `300ms`

这个 helper 只服务 `CmdAutoAuction` Step 8 的 ended-screen 分支，不对外暴露，不进入 `AggregateOperationSemantics.h`。

建议职责：

1. 读取 ended-screen 主按钮 ready 状态
2. 若 ready，返回路径
3. 若未 ready，尝试点击 `EndPanel/bg`
4. 记录 log
5. `SleepInterruptibly(300)`
6. 返回“本轮未 ready，需要外层继续”

外层 cleanup loop 继续负责：

- screen 检测
- authcode 检测
- stop/cancel 检测
- cleanup attempt 上限
- 后续 `WaitForScreenTransition(...)`

## Logging

为了便于后续观察效果，建议新增两类 native log：

1. 主按钮未 ready，执行背景跳过：
   - 包含 cleanup attempt 编号
   - 包含当前是 ended-screen waiting 阶段

2. 背景点击失败：
   - 包含 cleanup attempt 编号
   - 包含 `ClickNode(...)` 返回的错误字符串

不需要改变对外返回 JSON，只补 native log 即可。

## Testing and Verification

### Automated

这次逻辑主要落在 native `CmdAutoAuction` cleanup 分支，仓库当前没有直接覆盖整段 `CmdAutoAuction` 的 UI 仿真测试。

因此本轮 automated 验证重点不是强行补整段 aggregate 单测，而是：

- 保证现有仓库测试全部通过
- 不改动 `AggregateOperationSemantics.h` 现有 ended-screen 路径选择契约

### Manual

至少验证以下路径：

1. 对局正常结束后进入 `auction_ended`
2. 在战利品逐件揭露期间，现有主按钮尚未出现时，agent 会尝试点击背景
3. 每次背景点击尝试后，等待约 `300ms` 再继续检测
4. 一旦 `receiveBtn` 或 `continueBtn` 出现，agent 立即切回现有 cleanup 主流程
5. cleanup 最终仍能回到既有完成 screen
6. 若中途出现 `authcode`，仍然立即返回 `authcode_required`

## Acceptance Criteria

- `AutoAuction` 已进入结束页后，不再只是被动轮询 `receiveBtn/continueBtn`
- 当 ended-screen 主按钮未 ready 时，会主动尝试点击 `EndPanel/bg`
- 每次背景点击尝试后，会等待 `300ms` 再重试
- 一旦 ended-screen 主按钮 ready，立即继续现有 cleanup 点击逻辑
- 不改变 `AutoAuction` 现有对外业务结果和 cleanup 阶段错误码
- 不扩展到其他非 `AutoAuction` 流程

## Non-Goals

- 不修改 `DetectScreenState()` 的 screen 分类
- 不把 ended-screen 背景点击做成通用 overlay close 框架
- 不改 `CloseCurrentOverlay`
- 不改 `AutoAuction` 出价逻辑、房间逻辑或 `authcode` 处理契约
- 不扩展到 `cabinet_reward_*` 或其他奖励界面
