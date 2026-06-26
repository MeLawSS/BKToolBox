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
