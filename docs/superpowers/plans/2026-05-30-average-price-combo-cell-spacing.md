# Average Price Combo Cell Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide streamed Ethan average-price combo rows whose total cell counts are within 3 cells of any already displayed combo row.

**Architecture:** Keep the solver unchanged and filter in `appendPricePrediction`, where parsed combo candidates are already deduped and appended to the result table. The filter checks the candidate `cells` against displayed rows that represent the same streamed average-price combo path.

**Tech Stack:** Vue 3, Vitest, existing Ethan test helpers.

---

### Task 1: Filter Close Average-Price Combo Rows

**Files:**
- Modify: `src/ethan/App.vue`
- Test: `src/ethan/App.test.js`

- [ ] **Step 1: Write the failing test**

Add an App test that starts an average-price-only search, emits solver rows with `TotalCells` values `5`, `7`, `8`, `9`, and `13`, and asserts that only `5`, `9`, and `13` render because each displayed row must be at least 4 cells away from every already displayed row.

- [ ] **Step 2: Run the focused test**

Run: `npm test -- src/ethan/App.test.js`

Expected before implementation: the new test fails because close rows are currently shown.

- [ ] **Step 3: Implement the filter**

In `src/ethan/App.vue`, add a constant for the minimum spacing:

```js
const PRICE_COMBO_MIN_CELL_SPACING = 4;
```

Add a helper near `appendPricePrediction`:

```js
function hasPriceComboCellSpacing(candidate, rows) {
  return rows.every((row) =>
    !Number.isInteger(row.predictionCandidates?.[row.predictionGroupKey]?.cells) ||
    Math.abs(row.predictionCandidates[row.predictionGroupKey].cells - candidate.cells) >= PRICE_COMBO_MIN_CELL_SPACING
  );
}
```

Call this helper before appending a streamed candidate.

- [ ] **Step 4: Verify focused behavior**

Run: `npm test -- src/ethan/App.test.js`

Expected after implementation: App tests pass.

- [ ] **Step 5: Full verification and commit**

Run:

```bash
npm run build:ethan
npm test
```

Expected: build exits 0 and all tests pass. Commit the implementation files.
