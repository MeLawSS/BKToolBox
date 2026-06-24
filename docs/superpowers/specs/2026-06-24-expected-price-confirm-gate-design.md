# Expected Price Confirm Gate Design

**Date:** 2026-06-24  
**Scope:** `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` 中 `CmdAutoAuction` 的 `useExpectedPrice` 出价路径  
**Goal:** 让 expected-price 自动竞拍在最终点击确认出价前，必须等到“对手当前回合已出价”或“当前回合剩余时间小于 2 秒”二选一成立，同时保持现有开框、填金额、同轮节流和收尾语义不变。

## Context

当前 `CmdAutoAuction` 的 bid loop 已经具备以下行为：

- `useExpectedPrice` 路径会在每个新回合尽早决定本轮 `amount`
- 在第 2 到第 5 轮，会基于对手上一轮出价执行封顶逻辑
- 点击 `Gaming/chujia` 后会等待输入框出现、处理 `priceUpperLimit`、写入金额，并在准备好后立即点击 `InputDevice/Panel1/chujia`
- 同一轮点击 `Gaming/chujia` 已经有独立节流，且一轮成功确认后只会记一次 `lastBidRound`

用户本轮要的不是“更晚打开出价框”，而是“可以像现在一样提前开框和填金额，但在最终确认前必须再等一个门槛”。门槛满足以下其一即可：

1. 对手当前回合已经出价
2. 当前回合剩余时间小于 2 秒

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

- 对手当前回合价格格子是否已有有效文本
- 或 `secs < 2`

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
- 玩家每轮出价文本来自 `Player_N/containers/RoundUnit/priceTxt` 与 `RoundUnit(Clone)[N-2]/priceTxt`
- 第 1 轮价格格子路径固定为 `RoundUnit/priceTxt`
- 第 N 轮价格格子路径固定为 `RoundUnit(Clone)[N-2]/priceTxt`

现有 AutoAuction 代码已经具备以下可复用能力：

- `TryReadVisiblePlayerName(...)`：读取可见玩家名
- `TryResolveOpponentSlot(...)`：基于 `selfName` 与两个玩家名解析对手槽位
- `TryReadOpponentPreviousRoundBid(...)`：读取对手上一轮出价
- `ReadBidState(...)`：读取当前 round 和剩余秒数

因此本轮不需要重新发明对手识别语义，只需要新增“读取对手当前回合价格格子”的能力，并在确认前等待该信号。

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
2. `secs < 2`

这是一个纯“放行确认”的门槛，不影响本轮 `amount` 的计算来源，也不影响 opponent-cap 逻辑本身。

### Opponent Resolution

“对手是谁”的语义不单独设计，直接复用现有 opponent-cap 路径：

- 继续读取 `Player_1` / `Player_2` 的可见玩家名
- 继续以 `selfName` 为基准调用 `TryResolveOpponentSlot(...)`

这样能保证：

- 第 2 到第 5 轮封顶逻辑和新的确认门槛使用同一套对手判定
- 不会出现封顶按一个对手算、确认门槛又按另一个对手等的分裂语义

### Current-Round Bid Detection

新增一个 native helper，用于读取“对手当前回合”的价格格子：

- round 1：`Gaming/PlayerContainer/Player_<slot>/containers/RoundUnit/priceTxt`
- round N：`Gaming/PlayerContainer/Player_<slot>/containers/RoundUnit(Clone)[N-2]/priceTxt`

判定规则：

- 文本不存在、为空、或无法解析成价格：视为“对手当前回合尚未出价”
- 文本存在且能解析成有效价格：视为“对手当前回合已出价”

本轮只需要“是否已出价”的布尔语义，不需要把这个价格纳入新的对外返回结构。

## Waiting Strategy

### General Behavior

不新增新的点击重试路径。`Gaming/chujia` 仍然只在现有同轮节流放行后点一次。新增逻辑只发生在 bid dialog 内部、最终确认前。

### Polling Loop

在金额写入成功后，进入一个短轮询等待：

- 轮询间隔：`100ms`
- 每次轮询都继续检查：
  - cancel / unload
  - `authcode`
  - 当前 screen 是否还是 `auction_in_progress`
  - 当前 `secs`
  - 对手当前回合价格格子

放行条件：

- 读到对手当前回合价格格子有有效价格，立即放行
- 若始终未读到，但 `secs < 2`，立即按时间兜底放行

退出条件：

- 若中途进入 `auction_ended`，直接回到现有结束分支
- 若中途出现 `authcode`，沿用现有 `authcode_required` 结果
- 若 stop requested，则沿用现有 canceled 路径

### No New Independent Long Timeout

本轮不单独引入新的长 timeout。原因：

- 这段等待天然受当前回合剩余时间约束
- `secs < 2` 已经提供明确兜底
- 额外长 timeout 只会制造新的失败边界，但不提高业务价值

### Bid Dialog Loss

如果确认前等待过程中 bid dialog 意外丢失：

- 不新增新的硬失败码
- 沿用当前“本轮未完成确认，回到 observation loop 再看下一次状态”的容错方向

本轮重点是“在确认前加门槛”，不是重新定义 bid dialog 异常恢复。

## Internal Structure

### `MetaOperations.cpp`

新增或调整的职责集中在该文件：

- 增加读取“对手当前回合价格格子”的 helper
- 增加“确认前门槛等待”的 helper
- 在 `useExpectedPrice` 分支、写入金额成功后、点击最终确认前调用该 helper

建议 helper 形态：

- `TryReadOpponentCurrentRoundBid(...)`
- `WaitForExpectedPriceConfirmGate(...)`

`WaitForExpectedPriceConfirmGate(...)` 的返回语义应为三态而不是 bool：

- `ready_by_opponent_bid`
- `ready_by_time_fallback`
- `not_ready`

这样日志和调试可以明确区分门槛是如何被满足的。

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
- 只在两个关键时点打日志，避免 100ms poll 刷屏

建议日志点：

1. 首次进入“确认前等待门槛”时记录一次：
   - `round`
   - `secs`
   - `amount`
   - `opponentName`（若已解析）

2. 真正放行最终确认时记录一次：
   - `reason=opponent_bid` 或 `reason=time_fallback`
   - 若是 `opponent_bid`，附带 `opponentRoundBid`

这样手工验收和日志排障都可以直接看出某次确认是“等到了对手”还是“等到了小于 2 秒”。

## Testing Strategy

### Native Semantics Tests

在现有原生测试入口中增加纯语义断言，覆盖：

- 第 1 轮与第 N 轮的当前回合价格 path 选择
- `useExpectedPrice` 路径专用确认门槛不会污染 legacy 语义
- confirm-gate 结果的三态语义
- `secs < 2` 的时间兜底优先级

### Native Regression Coverage

需要锁住以下回归点：

- 同一轮 `Gaming/chujia` 点击节流仍不变
- expected-price 的 opponent-cap 逻辑仍先于确认门槛执行
- `legacy bidAmount` 仍保持现有 `secs < 15` 语义
- 现有确认收敛 helper 的 authcode 早返回不被破坏

### Manual Verification

至少手工验证以下场景：

1. `useExpectedPrice` 路径下，对手先出价，确认立即放行
2. 对手一直不出价，确认在 `< 2s` 时兜底放行
3. 仍会像现在一样提前开框和填入金额，不会把门槛前移到 `Gaming/chujia` 点击之前
4. legacy 固定金额自动竞拍行为不变
5. 确认前等待期间出现 authcode，仍返回 `authcode_required`
6. 确认前等待期间若对局直接结束，仍沿用现有 `auction_ended` 流程

## Acceptance Criteria

- `useExpectedPrice` 模式下，AutoAuction 仍会尽早打开出价框并填入金额
- 最终点击 `InputDevice/Panel1/chujia` 前，必须满足以下其一：
  - 已读到对手当前回合价格文本
  - 当前回合剩余时间 `< 2`
- `legacy bidAmount` 分支行为完全不变
- 同一轮点击 `Gaming/chujia` 的节流和“每轮最多一次成功确认”的契约保持不变
- 现有 expected-price 的对手上一轮封顶逻辑保持不变，新门槛只在其后、最终确认前生效
- `authcode_required`、取消、卸载、`auction_ended` 提前结束等现有退出语义保持兼容
- native log 能区分“等到对手当前回合出价才确认”和“等到 `<2s` 才兜底确认”两条路径

## Out of Scope

- 改造 `legacy bidAmount` 自动竞拍
- 接入 `119/193` 实时协议通知
- 修改 Electron bridge 或 renderer 展示结构
- 修改 expected-price 来源、防抖通知或 file watcher 语义
- 重写现有确认收敛流程或 bid dialog 异常恢复策略
