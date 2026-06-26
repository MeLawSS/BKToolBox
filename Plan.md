# Code Review Plan

## Milestones

1. Reproduce and classify current failures
   - Validation: `npm test`
   - Stop rule: do not patch until failures are grouped by root cause

2. Fix high-signal regressions first
   - Current priority:
     - shared monitor SSE lifecycle contract
     - Ethan combined / stream prediction regressions
   - Validation:
     - `npx vitest run src/shared/useMonitorSwitch.test.js`
     - `npx vitest run src/ethan/App.test.js -t "<targeted names>"`
     - `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js`

3. Triage remaining failing tests as review findings
   - Current candidates:
     - `scripts/watch-bidking-game-log.test.mjs`
     - `src/inject/controllerUiNodeLabels.test.js`
     - `server.test.mjs`
   - Validation: run each affected file in isolation

4. Document findings, fixes, and remaining risks
   - Validation: markdown files updated and aligned with current repo state

## Decision Notes

- Exclude security as requested by the user
- Keep input normalization semantics stable unless a broader contract change is explicitly required
- Prefer local, mode-specific fixes over global data-model changes when only one workflow is broken

## Target Architecture Notes

- Shared runtime utilities should expose one stable lifecycle contract for all consumers
- Worker, stream, and UI result paths should agree on supported result types
- Stream-specific companion logic may require explicit UI intent rather than inferring from normalized state alone
