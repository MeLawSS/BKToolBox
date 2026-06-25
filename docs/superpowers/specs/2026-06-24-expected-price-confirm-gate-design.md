# Expected Price Confirm Gate Design

**Date:** 2026-06-24  
**Scope:** `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` 中 `CmdAutoAuction` 的 `useExpectedPrice` 出价路径  
**Goal:** 让 expected-price 自动竞拍在最终点击确认出价前，必须等到“对手当前回合已出价”或“当前回合进入 2 秒兜底窗口”二选一成立，同时保持现有开框、填金额、同轮节流和收尾语义不变。

## Context

当前 `CmdAutoAuction` 的 bid loop 已经具备以下行为：

- `useExpectedPrice` 路径会在每个新回合尽早决定本轮 `amount`
- 在第 2 到第 5 轮，会基于对手上一轮出价执行封顶逻辑
- 点击 `Gaming/chujia` 后会等待输入框出现、处理 `priceUpperLimit`、写入金额，并在准备好后立即点击 `InputDevice/Panel1/chujia`
- 同一轮点击 `Gaming/chujia` 已经有独立节流，且一轮成功确认后只会记一次 `lastBidRound`

用户本轮要的不是“更晚打开出价框”，而是“可以像现在一样提前开框和填金额，但在最终确认前必须再等一个门槛”。门槛满足以下其一即可：

1. 对手当前回合已经出价
2. 当前回合进入 2 秒兜底窗口

## Constraints

- 只改 `useExpectedPrice` 自动竞拍路径
- `legacy bidAmount` 路径保持现状，不共享这条新门槛
- 不引入抓包 / monitor / Electron / renderer 新链路
- 不新增新的对外命令，不改 `AutoAuction` 对外成功返回结构
- 不改变现有“每轮最多一次成功确认”的契约
- 不破坏现有 expected-price 的对手上一轮封顶逻辑
- 不破坏 `authcode_required`、`canceled`、`auction_ended` 等现有退出语义

## Approaches Considered

### Approach A: 接入实时协议出价通知

监听 `119/193` 玩家出价通知，把“某玩家刚出价”的信号接到 AutoAuction native 状态，再决定是否放行确认。

优点：

- 语义最接近“刚出价”
- 不依赖 UI 文本渲染

缺点：

- 需要打通协议解析、监控、Electron bridge、agent 多段链路
- 明显超出“只改 `useExpectedPrice` 路径”的本轮范围

### Approach B: 在 native UI 层读取对手当前回合出价

继续在 `CmdAutoAuction` 内判断。保留当前“先开框、处理 toggle、写入金额”的路径，只在最终点击 `InputDevice/Panel1/chujia` 前轮询：

- 对手当前回合 `bided` live signal 是否已经亮起
- 或进入 2 秒兜底窗口

优点：

- 改动集中在 native AutoAuction 内部
- 可以复用当前 battle UI 读取、对手槽位解析、轮次和节流逻辑
- 不扩散到 app、bridge 或协议消费面

缺点：

- 依赖当前 battle UI 的文本渲染时序
- 需要设计一个短轮询等待，避免日志刷屏或误判

### Approach C: Hybrid，优先协议，回退 UI

优先吃实时协议出价通知，拿不到时再回退到 UI 文本判断。

优点：

- 最稳妥

缺点：

- 实现复杂度最高
- 不符合本轮最小改动目标

## Decision

采用 **Approach B**。

本轮只在 native `CmdAutoAuction` 内增加“确认前门槛”，复用现有 UI 读取能力，不引入新的跨进程或跨模块状态同步。

## Existing Reverse-Engineering Facts Used

现有逆向信息已经足够支持“对手当前回合已出价”的 UI 判定：

- 当前轮次来自 `Gaming/Center/RoundBg/roundTxt`
- `Gaming/PlayerContainer/Player_N/bided` 是当前回合是否已出价的 live marker
- `RoundUnit/priceTxt` 与 `RoundUnit(Clone)[N-2]/priceTxt` 更适合作为回合历史展示，而不是当前回合确认前 gate 的 live signal
- 当前 1v1 竞拍里，本地玩家自己的 `bided` 不会在最终 confirm 前亮起；因此 confirm 前若只观察到一个 active `bided` marker，它代表的是对手已出价

现有 AutoAuction 代码已经具备以下可复用能力：

- `TryReadVisiblePlayerName(...)`：通过 `Gaming/PlayerContainer/Player_%d/...` 读取可见玩家名
- `TryResolveOpponentSlot(...)`：基于 `selfName` 与两个玩家名解析对手槽位
- `TryReadOpponentPreviousRoundBid(...)`：通过 `Gaming/PlayerContainer/Player_%d/containers/...` 读取对手上一轮出价
- `ReadBidState(...)`：读取当前 round 和剩余秒数

因此本轮不需要重新发明对手识别语义，只需要新增“读取当前回合 live bid signal”的能力，并在确认前等待该信号。

## Design Overview

`useExpectedPrice` 路径继续保持当前节奏：

1. 进入某个新回合
2. 计算 expected-price 分支的 `amount`
3. 如处于第 2 到第 5 轮，继续执行现有 opponent-cap 逻辑
4. 点击 `Gaming/chujia`
5. 等待 bid dialog 出现
6. 必要时关闭 `priceUpperLimit`
7. 写入金额
8. **新增：在最终确认前等待门槛**
9. 门槛满足后点击 `InputDevice/Panel1/chujia`
10. 继续沿用现有确认收敛逻辑

新门槛只插在步骤 8，不改变前面 1 到 7 的开框与填金额节奏。

## Confirm Gate Semantics

### Scope

新门槛只在以下条件同时成立时生效：

- 当前分支为 `useExpectedPrice`
- `placeBidClicked == true`
- bid dialog 已出现且 active
- `PerformSetInputText(...)` 已成功写入金额

`legacy bidAmount` 分支完全不受影响。

### Gate Condition

允许点击最终确认按钮，当且仅当以下其一成立：

1. 已检测到对手在当前回合的价格格子中出现可解析价格
2. 当前回合已进入 2 秒兜底窗口（实现上使用 `secs <= 2`）

这是一个纯“放行确认”的门槛，不影响本轮 `amount` 的计算来源，也不影响 opponent-cap 逻辑本身。

### Opponent Resolution

“对手是谁”的语义不单独设计，直接复用现有 opponent-cap 路径：

- 继续读取 `Player_1` / `Player_2` 的可见玩家名
- 继续以 `selfName` 为基准调用 `TryResolveOpponentSlot(...)`

这样能保证：

- 第 2 到第 5 轮封顶逻辑和新的确认门槛使用同一套对手判定
- 不会出现封顶按一个对手算、确认门槛又按另一个对手等的分裂语义

如果某次 gate 轮询时玩家名尚未渲染完、导致对手槽位暂时不可解析，不把它当成硬失败；继续轮询，并在需要时自然退化到时间兜底。

### Current-Round Bid Detection

新增一个 native helper，用于读取 battle UI 当前回合的 live bid signal。这里的 `Gaming/PlayerContainer/...` 前缀不是新的猜测，而是直接与现有 working code 保持一致：`TryReadVisiblePlayerName(...)` 与 `TryReadOpponentPreviousRoundBid(...)` 当前都从该前缀下读取 battle UI。

- live signal path：`Gaming/PlayerContainer/Player_<slot>/bided`
- `RoundUnit/priceTxt` 和 `RoundUnit(Clone)[N-2]/priceTxt` 在当前实现里保留给历史回合展示，不再作为确认 gate 的依据

判定规则：

- 当前实现读取全部可见 `bided` marker 数量，并把“恰好 1 个 active marker”视为“对手当前回合已出价”
- 这个聚合判定依赖当前 1v1 运行时约束：本地玩家自己的 `bided` 不会在最终 confirm 前亮起
- 若 entry 时已经有 active marker，gate 不再等待 signal transition，直接按当前 signal state 或时间兜底继续

本轮只需要“是否已出价”的布尔语义，不需要把这个 signal 纳入新的对外返回结构。

## Waiting Strategy

### General Behavior

`Gaming/chujia` 仍然只在现有同轮节流放行后点一次。新增逻辑只发生在 bid dialog 内部、最终确认前。当前实现在 `ready_by_opponent_bid` 放行后还会额外等待 `1000ms`，再进入最终确认。

新增 helper 的返回语义继续保持“三态”，但 contract 需要明确：

- `ready_by_opponent_bid`
- `ready_by_time_fallback`
- `not_ready`

其中：

- `ready_by_opponent_bid` 表示当前回合 `bided` live signal 已满足放行条件，允许继续进入最终确认路径
- `ready_by_time_fallback` 表示未读到对手出价，但当前回合已经进入兜底时间窗口，允许立即点击最终确认
- `not_ready` **只用于 caller-managed soft exit**，也就是“这次确认尝试应当放弃并回到外层 observation loop，但不属于业务硬失败”

`not_ready` 的具体适用范围限定为：

- `round_changed`：等待过程中当前 round 已变，不再允许继续用旧 round 的 dialog 和路径确认
- `dialog_lost`：等待过程中 bid dialog 不再 active，caller 在 gate 内部先退出当前等待；当前实现会在对手出价放行后的后置阶段尝试恢复同轮 dialog

以下 hard exit **不通过 `not_ready` 折叠返回**：

- `authcode`
- `cancel_requested`
- `agent_unloading`
- `auction_ended`

这些沿用现有 AutoAuction 路径分别传播，不让 caller 把它们误当成“安全可重试”的软退出。

### Polling Loop

在金额写入成功后，进入一个短轮询等待：

- 轮询间隔：`100ms`
- 每次轮询都继续检查：
  - cancel / unload
  - `authcode`
  - 当前 screen 是否还是 `auction_in_progress`
  - 当前 `secs`
  - 当前 `round`
  - 当前回合 `bided` live signal

放行条件：

- 读到当前回合 `bided` live signal 满足放行条件，立即放行
- 若始终未读到，但 `secs <= 2`，立即按时间兜底放行

这里实现上使用 `secs <= 2` 而不是严格 `< 2`。原因是 `ReadBidState()` 的秒数读数是离散值，100ms 轮询时可能从 `2` 直接跳到 `0`。把“进入 2 秒兜底窗口”定义为 `secs <= 2`，可以避免因为 UI 秒数更新粒度而错过门槛。

退出条件：

- 若中途进入 `auction_ended`，直接回到现有结束分支
- 若中途出现 `authcode`，沿用现有 `authcode_required` 结果
- 若 stop requested，则沿用现有 canceled 路径
- 若当前 round 与进入 gate 时记录的 round 不一致，返回 `not_ready`，由 caller 放弃这次确认尝试并回到外层 observation loop
- 若 bid dialog 在 gate 等待过程中不再 active，返回 `not_ready`，由 caller 放弃这次确认尝试并回到外层 observation loop

### Round Change Handling

进入 gate 时记录 `gateEntryRound`。每次轮询重新调用 `ReadBidState()` 时，都必须比较当前 round 与 `gateEntryRound`：

- 如果 round 未变化，继续按当前 signal state 判断“对手是否已出价”
- 如果 round 已变化，则当前 dialog 与当前回合 signal state 都视为 stale，不再允许继续用旧 round 的确认尝试

这个 round-change 分支不应被误判为“对手当前回合已出价”。它应作为 soft exit 返回给 caller，让外层 observation loop 重新以新 round 建立下一次出价尝试。按当前运行时约束，在本地玩家尚未最终 confirm 前不会推进到下一轮；若 UI 真的切轮，原确认框也会随之消失，因此后置的 confirm-delay / dialog-recovery 路径默认仍处于同一轮上下文。

### No New Independent Long Timeout

本轮不单独引入新的长 timeout。原因：

- 这段等待天然受当前回合剩余时间约束
- `secs <= 2` 已经提供明确兜底
- 额外长 timeout 只会制造新的失败边界，但不提高业务价值

### Bid Dialog Loss

如果确认前等待过程中 bid dialog 意外丢失，或 round 已推进到下一轮：

- 不新增新的硬失败码
- gate 内部仍沿用“本轮未完成确认，回到 observation loop 再看下一次状态”的容错方向
- 但在 `ready_by_opponent_bid` 放行后，当前实现允许一次同轮恢复：若 bid dialog 暂时消失，会先尝试重新点击 `Gaming/chujia` 打开 dialog，再复核输入金额
- helper 返回 `not_ready` 时必须附带 soft-exit reason，避免 caller 把所有未放行情况都当成同一种状态

本轮重点仍然是“在确认前加门槛”；新增的 dialog recovery 只是为了在同轮、对手已出价放行后，避免 UI 短暂收起 dialog 导致确认机会丢失。

## Internal Structure

### `MetaOperations.cpp`

新增或调整的职责集中在该文件：

- 增加读取当前回合 `bided` live signal 的 helper
- 增加“确认前门槛等待”的 helper
- 在 `useExpectedPrice` 分支、写入金额成功后、点击最终确认前调用该 helper
- 在对手出价放行后增加 `1000ms` confirm delay
- 在对手出价放行后若 dialog 暂失，允许同轮恢复 bid dialog，并在最终 confirm 前复核/重写输入框金额

建议 helper 形态：

- `ReadCurrentRoundBidSignals(...)`
- `WaitForExpectedPriceConfirmGate(...)`

`WaitForExpectedPriceConfirmGate(...)` 的返回语义应为三态而不是 bool：

- `ready_by_opponent_bid`
- `ready_by_time_fallback`
- `not_ready`

这样日志和调试可以明确区分门槛是如何被满足的。同时 helper 还需要让 caller 能区分 `not_ready` 的 soft-exit reason，至少区分：

- `round_changed`
- `dialog_lost`

`authcode` / stop / `auction_ended` 不通过这个 soft-exit reason 通道折叠。

### `AggregateOperationSemantics.h`

只放纯语义函数或纯 path 规则，避免把更多 UI 读写塞进 header。

适合放入的内容：

- 当前回合价格格子 path 的选择规则
- confirm-gate 结果枚举或小型格式化 helper
- 与 `useExpectedPrice` 专属门槛有关的纯判断语义

不把需要 `Il2CppObject*`、`ResolveUiNodeMatches(...)`、`ReadNodeTextValue(...)` 的逻辑移动到 header。

## Logging and Observability

本轮不改 `AutoAuction` 对外成功返回结构，只增强 native log。

日志控制原则：

- 不在每次 `not_ready` 轮询都打日志
- 只在关键状态转移时打日志，避免 100ms poll 刷屏

建议日志点：

1. 首次进入“确认前等待门槛”时记录一次：
   - `round`
   - `secs`
   - `amount`
   - `opponentName`（若已解析）

2. 真正放行最终确认时记录一次：
  - `reason=opponent_bid` 或 `reason=time_fallback`
   - 若是 `opponent_bid`，附带 `signal=bided` 与 signal count / transition 信息

3. gate 被中断并放弃本次确认尝试时记录一次：
   - `reason=round_changed` 或 `reason=dialog_lost`
   - 若是 hard exit，则沿用现有 authcode / canceled / auction_ended 日志语义

这样手工验收和日志排障都可以直接看出某次确认是“等到了对手”还是“进入了 2 秒兜底窗口”。

## Testing Strategy

### Native Semantics Tests

在现有原生测试入口中增加纯语义断言，覆盖：

- 当前回合 `bided` signal path 选择
- `useExpectedPrice` 路径专用确认门槛不会污染 legacy 语义
- confirm-gate 结果的三态语义
- `not_ready` 只用于 soft exit，不折叠 authcode / cancel / `auction_ended`
- round-change soft exit 语义
- `secs <= 2` 的时间兜底优先级
- 当前 1v1 运行时下，“自己未 confirm 前 self `bided` 不亮”这一前提对应的 count-based 判定语义

### Native Regression Coverage

需要锁住以下回归点：

- 同一轮 `Gaming/chujia` 点击节流仍不变
- expected-price 的 opponent-cap 逻辑仍先于确认门槛执行
- `legacy bidAmount` 仍保持现有 `secs < 15` 语义
- 现有确认收敛 helper 的 authcode 早返回不被破坏

### Manual Verification

至少手工验证以下场景：

1. `useExpectedPrice` 路径下，对手先出价，gate 按 `bided` signal 放行，日志记录 `reason=opponent_bid signal=bided`
2. 对手一直不出价，确认在 `<= 2s` 时兜底放行
3. 对手出价放行后会额外等待 `1000ms`，再进入最终确认
4. 若对手出价放行后 dialog 暂时消失，当前实现会尝试重新开框，并在最终 confirm 前复核/必要时重写金额
5. 仍会像现在一样提前开框和填入金额，不会把门槛前移到 `Gaming/chujia` 点击之前
6. legacy 固定金额自动竞拍行为不变
7. 确认前等待期间出现 authcode，仍返回 `authcode_required`
8. 确认前等待期间若对局直接结束，仍沿用现有 `auction_ended` 流程

## Acceptance Criteria

- `useExpectedPrice` 模式下，AutoAuction 仍会尽早打开出价框并填入金额
- 最终点击 `InputDevice/Panel1/chujia` 前，必须满足以下其一：
  - 已观察到对手当前回合 `bided` live signal
  - 当前回合已进入 2 秒兜底窗口（实现上使用 `secs <= 2`）
- `legacy bidAmount` 分支行为完全不变
- 同一轮点击 `Gaming/chujia` 的节流和“每轮最多一次成功确认”的契约保持不变
- 现有 expected-price 的对手上一轮封顶逻辑保持不变，新门槛只在其后、最终确认前生效
- `authcode_required`、取消、卸载、`auction_ended` 提前结束等现有退出语义保持兼容
- 当前 1v1 运行时下，本地玩家未最终 confirm 前不会推进到下一轮；若 UI 真正切轮，原确认框会一起消失
- native log 能区分“等到对手当前回合出价才确认”和“进入 2 秒兜底窗口才确认”两条路径

## Out of Scope

- 改造 `legacy bidAmount` 自动竞拍
- 接入 `119/193` 实时协议通知
- 修改 Electron bridge 或 renderer 展示结构
- 修改 expected-price 来源、防抖通知或 file watcher 语义
- 重写现有确认收敛流程或 bid dialog 异常恢复策略
