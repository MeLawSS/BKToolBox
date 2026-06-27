# Code Review Log

## Scope

- Repository: `A:\BidKing`
- Review dimensions:
  - correctness
  - regressions
  - testing contract
  - test self-containment
  - maintainability
- Excluded:
  - security

## Current Status

- Reproduced the initial failing test set from `npm test`
- Reduced the Ethan / shared-runtime failures to two root causes
- Implemented and verified fixes for:
  - shared monitor SSE lifecycle test contract
  - Ethan orange `price-only` companion expansion
  - Ethan stream summary range updates
  - worker/UI handling for `combined` result and row updates
  - `watch-bidking-game-log` self-contained table metadata fixture
  - `controller-ui-node-labels` test/data contract alignment

## Implemented Decisions

1. `useMonitorSwitch` now uses a ref-counted shared EventSource lifecycle.
   - Tests should verify release on last unsubscribe, not arbitrary manual `close()`.

2. Ethan orange `price-only` stream companion expansion is now driven by explicit UI intent.
   - If an earlier prediction group has explicit `avg` and explicit `cells`, the stream may reuse that group as an average-companion range.
   - This avoids changing global normalized-state semantics.

3. Stream summary cards now recompute `low` / `high` across rows after row updates.
   - `summary.total` remains anchored to the first row mean, matching current UI contract.

## Verified Commands

- `npx vitest run src/shared/useMonitorSwitch.test.js`
- `npx vitest run src/ethan/App.test.js -t "uses purple average candidates when streaming orange price-only matches|expands summary range across multiple orange price-only stream rows|shows monitor-filled quality fields as placeholder and clears them on reload|combines purple and orange average predictions instead of ignoring orange candidates|prioritizes exact total-cell combined average predictions in the UI"`
- `npx vitest run src/shared/useMonitorSwitch.test.js src/shared/TopBar.test.js src/ethan/estimator.test.js src/ethan/App.test.js src/hero-estimator/HeroEstimatorPanel.test.js`
- `npx vitest run scripts/watch-bidking-game-log.test.mjs src/inject/controllerUiNodeLabels.test.js server.test.mjs`
- `npx vitest run src/shared/useMonitorSwitch.test.js src/shared/TopBar.test.js src/ethan/estimator.test.js src/ethan/App.test.js src/hero-estimator/HeroEstimatorPanel.test.js scripts/watch-bidking-game-log.test.mjs src/inject/controllerUiNodeLabels.test.js server.test.mjs`

## Findings Still Open

1. `server.test.mjs`
   - Route test behavior is coupled to built `public/*/index.html` artifacts, which obscures the real contract.

## Dirty Worktree Notes

- Unrelated pre-existing changes remain in:
  - `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
  - `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
  - `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`
  - `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

## 2026-06-28 AutoAuction confirm gate

- New task in worktree `feat/autoauction-end-skip`: reduce expected-price confirm wait after player dropouts.
- Confirmed rule with user: from round 2 onward, wait for `上一回合出价且出价 > 0 的玩家数量 - 1`.
- First round must remain unchanged.
- Implementation approach: keep the gate threshold rule in `AggregateOperationSemantics.h`, feed it with a previous-round positive-bidder count gathered from history rows in `MetaOperations.cpp`, and fall back to the visible-player rule when history is unavailable.
- Implemented: expected-price confirm gate now derives required opponent `bided` count from prior-round positive bidders when `gateEntryRoundNumber > 1`; otherwise it keeps the old visible-player rule.
- Guardrails kept:
  - first round unchanged
  - if any visible player's prior-round history row cannot be read, the gate falls back to the visible-player rule
  - a prior-round positive bidder count of `1` releases immediately with required other bids = `0`

### Verification

- Red step:
  - `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_confirm_gate_agg_test"`
  - failed as expected with helper arity errors before implementation
- Green step:
  - `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_confirm_gate_agg_test && /tmp/bk_autoauction_confirm_gate_agg_test"`
  - `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/bk_autoauction_confirm_gate_meta_test && /tmp/bk_autoauction_confirm_gate_meta_test"`

## 2026-06-28 AutoAuction ended-screen skip

- Ended-screen reveal skipping now runs across the full ended-screen tail, not only the primary-action cleanup branch.
- Step 7 winner / quick-recycle waiting now uses a 30s wall-clock deadline via `GetAutoAuctionEndedWinnerRevealSkipBudgetMs()`.
- Step 8 primary-action waiting now uses a 40s wall-clock deadline via `GetAutoAuctionEndedCleanupRevealSkipBudgetMs()`.
- Background skip attempts click `EndPanel/bg`, then observe a sliced 300ms settle window through `RunAutoAuctionEndedRevealSkipSettleWindow(...)` instead of blind-sleeping.
- The 300ms settle window is capped by remaining stage budget through `ClampAutoAuctionEndedRevealSkipWindowMs(...)`, so the old Step 7 / Step 8 wall-clock budgets are not implicitly stretched.

### Verification

- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_end_skip_agg_test && /tmp/bk_autoauction_end_skip_agg_test"`
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/bk_autoauction_end_skip_meta_test && /tmp/bk_autoauction_end_skip_meta_test"`
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"`
- `npm test`
