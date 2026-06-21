# Purple Total Price Tools Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tools tab that finds purple collectible combinations matching a target total price.

**Architecture:** Reuse the existing Tools tab pipeline: Vue tab metadata launches an allowlisted solver script through `/run`, the solver streams the same `TotalCells/TotalPrice/Count` lines, and the existing table parser renders/filter/sorts the results. Create a focused purple-total solver by mirroring the gold-total solver and changing only the quality predicate and usage text.

**Tech Stack:** Vue 3, Express, Node worker_threads, Vitest.

---

### Task 1: Add Tests

**Files:**
- Modify: `src/elsa/App.test.js`
- Modify: `server.test.js` if the allowlist has route-level tests; otherwise validate through existing app tests.
- Create: `solve-purple-total.js`

- [ ] **Step 1: Write failing Tools tab tests**

Add assertions that Tools renders 9 tabs including `紫色 · 总价格`, and selecting the new tab with `15600` starts `/run?script=solve-purple-total.js&args=15600`.

- [ ] **Step 2: Write failing solver smoke test if an existing solver test pattern is available**

Run the new script with a known purple total such as `10380` and assert it prints `TotalPrice=10380`.

- [ ] **Step 3: Run focused tests**

Run: `npx vitest run src/elsa/App.test.js`

Expected before implementation: fail because the tab and script URL do not exist.

### Task 2: Implement Solver And Wiring

**Files:**
- Create: `solve-purple-total.js`
- Modify: `src/elsa/App.vue`
- Modify: `src/shared/messages.js`
- Modify: `server.js`

- [ ] **Step 1: Add `solve-purple-total.js`**

Mirror `solve-gold-total.js`, use `prepareItems(require('./collectibles.json'), x => x.quality === '紫', 'price')`, keep output format unchanged.

- [ ] **Step 2: Add Tools tab metadata**

Insert a `tools.tabs.purpleTotal` tab near purple price/grid tools. It uses one required decimal field with `tools.fields.totalPrice` and `tools.placeholders.totalPrice`, `script: 'solve-purple-total.js'`, and `resultMode: 'table'`.

- [ ] **Step 3: Add i18n labels**

Add Chinese `purpleTotal: '紫色 · 总价格'` and English `purpleTotal: 'Purple · Total Price'`.

- [ ] **Step 4: Allow the script on `/run`**

Add `solve-purple-total.js` to the existing `allowed` list in `server.js`.

### Task 3: Verify And Commit

**Files:**
- All files above.

- [ ] **Step 1: Run focused test**

Run: `npx vitest run src/elsa/App.test.js`

Expected: pass.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: pass.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-24-purple-total-price-tools-tab.md src/elsa/App.vue src/elsa/App.test.js src/shared/messages.js server.js solve-purple-total.js
git commit -m "feat: add purple total price tool"
```
