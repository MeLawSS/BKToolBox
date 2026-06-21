# Ethan Monitor Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live Monitor controls and a 43 x 10 outline board to Ethan, populated from BidKing hero skill `1002081` events.

**Architecture:** Ethan will reuse the existing `/api/bidking-monitor/*` API and SSE stream. Board parsing is isolated in `src/ethan/monitor-grid.js`; `src/ethan/App.vue` owns monitor status, stream connection, and rendering. Styling stays in existing `public/ethan/ethan.css` because Ethan imports that CSS directly.

**Tech Stack:** Vue 3 Composition API, Vitest + Vue Test Utils, existing Express Monitor API, browser EventSource.

---

### Task 1: Board Parsing Helper

**Files:**
- Create: `src/ethan/monitor-grid.js`
- Test: `src/ethan/monitor-grid.test.js`

- [ ] Write failing tests for row-major box mapping, `itemSlotType` dimensions, duplicate event keys, new game reset, ignored non-1002081 events, and invalid placements.
- [ ] Run `npx vitest run src/ethan/monitor-grid.test.js`; expect failure because module does not exist.
- [ ] Implement `createEmptyMonitorGridState`, `createMonitorCells`, `parseSlotType`, and `applyMonitorEventToGridState`.
- [ ] Run `npx vitest run src/ethan/monitor-grid.test.js`; expect pass.
- [ ] Commit helper and tests.

### Task 2: Ethan Monitor UI Behavior

**Files:**
- Modify: `src/ethan/App.test.js`
- Modify: `src/ethan/App.vue`
- Modify: `src/shared/messages.js`

- [ ] Write failing Ethan tests for board render, topbar start/stop switch calls, `1002081` SSE fill, type display, new game reset, and unrelated skill ignore.
- [ ] Run `npx vitest run src/ethan/App.test.js`; expect failure for missing UI and behavior.
- [ ] Add Ethan monitor state, status fetch, start/stop actions, SSE connection, board computed cells, and template markup.
- [ ] Add zh/en i18n messages for monitor switch, board title, reveal type labels, warnings, and empty state.
- [ ] Run `npx vitest run src/ethan/App.test.js`; expect pass.
- [ ] Commit App behavior and messages.

### Task 3: Styling and Integration Verification

**Files:**
- Modify: `public/ethan/ethan.css`
- Test: relevant existing test suites

- [ ] Add compact topbar Monitor switch styles and dense 43 x 10 board styles with stable dimensions.
- [ ] Run `npx vitest run src/ethan/monitor-grid.test.js src/ethan/App.test.js src/monitor/App.test.js`.
- [ ] Run `npm run build:pages`.
- [ ] Run `git diff --check`.
- [ ] Commit styling and integration fixes.
