# Auto Auction Confirm Gate Active Bidders Design

## Goal

优化 `autoauction` 的 expected-price 确认出价门控，避免有玩家中途退出后仍按当前房间可见人数等待过多 `bided` 信号，导致确认出价被无意义拖慢。

## Current Behavior

当前确认门控只依赖“当前可见玩家数 - 1”：

- 第 1 回合等待 `visibleNamedPlayerCount - 1` 个当前回合 `bided`
- 第 2 回合及以后仍沿用同一规则

这个规则默认房间内所有可见玩家都会持续参与后续回合。若有人在前一回合后弃权或退出，但名字仍短暂保留在 UI 中，则确认门控会等待一个永远不会出现的 `bided`。

## Required Behavior

从第 2 回合开始，确认出价需要等待的对手 `bided` 数量改为：

`上回合出价且出价 > 0 的玩家数量 - 1`

说明：

- 这里的“`- 1`”是为了扣除我方自己，因为我方上一回合也已出价
- 第 1 回合保持现状，仍按当前可见玩家数推导等待人数
- 只有当上一回合历史数据可可靠读出时，才使用该历史人数
- 如果历史数据不可用、人数异常或无法识别，则回退到现有规则，避免误判或卡死

## Design

### Confirm Gate Target Resolution

把“需要等待多少个其他玩家 `bided`”抽成显式语义函数，输入包括：

- `visibleNamedPlayerCount`
- `currentRoundNumber`
- `previousRoundPositiveBidderCount`

规则：

- `currentRoundNumber <= 1` 时，返回 `max(0, visibleNamedPlayerCount - 1)`
- `currentRoundNumber >= 2` 且 `previousRoundPositiveBidderCount >= 1` 时，返回 `max(0, previousRoundPositiveBidderCount - 1)`
- 其他情况回退到 `max(0, visibleNamedPlayerCount - 1)`

### Previous-Round Positive Bidder Count

在确认门控观测阶段，从玩家历史出价区读取“上一回合 `priceTxt` 可解析且数值大于 0”的玩家数量。

范围：

- 只统计当前 battle UI 中可遍历到的玩家槽位
- 包含我方自己
- 同一槽位如果上一回合历史缺失、不可解析或价格 `<= 0`，不计入

### Fallback Behavior

以下情况一律回退到现有规则：

- 当前回合号无法识别或小于等于 1
- 上一回合正出价人数统计失败
- 统计结果小于等于 0

这样可以保证：

- 第 1 回合行为不变
- 历史 UI 延迟或缺失时不会让确认逻辑过早放行
- 异常状态下不会比当前实现更脆弱

## Files

- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
  - 增加“确认门控等待人数”的统一语义函数
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
  - 覆盖第 2 回合起基于上一回合正出价人数的等待规则
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
  - 在确认门控观测时读取上一回合正出价人数，并把该值传入语义函数

## Testing

- 先在 `AggregateOperationSemantics.test.cpp` 写失败用例，验证：
  - 第 1 回合仍按可见人数
  - 第 2 回合起优先按上一回合正出价人数 `- 1`
  - 历史人数无效时回退到可见人数规则
- 再跑 `test_agg`
- 最后按需要跑 `test_meta`
