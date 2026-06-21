# Ethan/Elsa: Async Price-Average Combination Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When purple/gold has `priceAverage`, search for a real item combination in the Worker after the initial result is displayed and replace the formula-based price with the actual market price via a reactive delta update.

**Architecture:** The sync cell-match is made skip-aware (prediction groups bypass it so they always produce formula pricing); a new `runPriceMatchPhase` function in `estimation-worker-core.js` runs the async search after the initial result rows are sent, posting `price-match-update` / `price-match-done` messages before `done`; the panel handles those messages by patching the reactive row and summary data.

**Tech Stack:** Vitest, Vue 3 (reactive refs), existing estimator search functions (`findTotalForAveragePrice`, `hasMatchingAveragePriceCombination`, `findFirstAveragePriceCellMatch`), all already imported in `estimation-worker-core.js`

---

## File Map

| File | What changes |
|------|-------------|
| `src/ethan/estimation-worker-core.js` | Add `skipGroupKeys` param; pass `predictionGroupKeys` as skipGroupKeys; add + export `runPriceMatchPhase`; add `PER_CELL_EXPECTED` import |
| `src/ethan/estimation-worker.js` | Import `runPriceMatchPhase`; call it before `done` in both branches |
| `src/hero-estimator/useHeroEstimatorPanel.js` | Add `groupKey` to direct rows; update `needsAveragePriceCombination`; add `applyPriceMatchUpdate` + message handlers |
| `src/ethan/estimator.test.js` | Add imports; add 6 tests (spec tests 1–5 + regression) |
| `src/hero-estimator/HeroEstimatorPanel.test.js` | Update 1 existing test; add 3 new tests (spec tests 6–8) |

---

### Task 1: Add `skipGroupKeys` param to `applyAveragePriceCellMatchOverridesForWorker`

**Files:**
- Modify: `src/ethan/estimation-worker-core.js:26-30`
- Test: `src/ethan/estimator.test.js`

- [ ] **Step 1: Add `applyAveragePriceCellMatchOverridesForWorker` to the import in `estimator.test.js`**

  File: `src/ethan/estimator.test.js`, lines 31–34.

  ```js
  import {
    DEFAULT_ESTIMATION_OUTPUT_LIMIT,
    applyAveragePriceCellMatchOverridesForWorker,
    calculateEstimationResult,
  } from './estimation-worker-core.js';
  ```

- [ ] **Step 2: Write the failing test (spec test 5)**

  Add inside the `describe('Ethan worker estimation core', ...)` block after the existing tests:

  ```js
  it('applyAveragePriceCellMatchOverridesForWorker skips groups listed in skipGroupKeys', () => {
    const state = collect({}, { purple: { cells: '4', priceAverage: '8974' } });

    const { state: skipped, missingMatches: skippedMissing } =
      applyAveragePriceCellMatchOverridesForWorker(state, { purple: realPurpleItems }, undefined, ['purple']);

    expect(skipped.groups.purple.valueOverride).toBeUndefined();
    expect(skippedMissing).toHaveLength(0);

    const { state: included } =
      applyAveragePriceCellMatchOverridesForWorker(state, { purple: realPurpleItems }, undefined, []);

    expect(included.groups.purple.valueOverride).toBe(8974);
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: FAIL — `applyAveragePriceCellMatchOverridesForWorker` has no 4th param yet.

- [ ] **Step 4: Add `skipGroupKeys` param and skip logic**

  In `src/ethan/estimation-worker-core.js`, change the function signature at line 26 and add the guard at the top of the group loop:

  ```js
  export function applyAveragePriceCellMatchOverridesForWorker(
    state,
    collectibleItemsByGroup,
    groups = ESTIMATION_GROUPS,
    skipGroupKeys = []
  ) {
    const stateGroups = Object.fromEntries(groups.map((group) => [
      group.key,
      { ...state.groups[group.key] },
    ]));
    const missingMatches = [];
    let hasOverride = false;

    for (const group of groups) {
      if (skipGroupKeys.includes(group.key)) continue;
      const input = stateGroups[group.key];
      if (
        input.cells === null ||
        input.priceAverage === null ||
        input.count !== null ||
        Number.isFinite(input.valueOverride)
      ) {
        continue;
      }
      // ... rest unchanged
  ```

- [ ] **Step 5: Run test to verify it passes**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: PASS

- [ ] **Step 6: Commit**

  ```bash
  git add src/ethan/estimation-worker-core.js src/ethan/estimator.test.js
  git commit -m "$(cat <<'EOF'
  feat: add skipGroupKeys param to applyAveragePriceCellMatchOverridesForWorker

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: `calculateEstimationResult` passes `predictionGroupKeys` as skipGroupKeys

**Files:**
- Modify: `src/ethan/estimation-worker-core.js:105-109`
- Modify: `src/ethan/estimator.test.js` (update line 683 call + add regression test)

- [ ] **Step 1: Update the existing "resolves exact average-price cell matches" test**

  The test at line ~683 calls `calculateEstimationResult` without `predictionGroupKeys`, so after the fix it would use the default `['purple', 'orange']` as skipGroupKeys and purple's match would no longer be set. Add `predictionGroupKeys: []` to that call so it keeps testing the sync match path:

  In `src/ethan/estimator.test.js`, inside `it('resolves exact average-price cell matches off the main app path', ...)`:

  ```js
  const result = calculateEstimationResult({
    state,
    predictionGroupKeys: [],
    collectibleItemsByGroup: { purple: realPurpleItems },
    priceProfilesByGroup: realPriceProfilesByGroup,
  });
  ```

- [ ] **Step 2: Write the regression test**

  Add after the updated existing test, still inside `describe('Ethan worker estimation core', ...)`:

  ```js
  it('skips prediction groups from sync cell match so they produce direct result instead of priceCellsNoMatch', () => {
    // priceAverage=1 never matches any real purple item; previously caused type:'empty'
    const state = collect({}, { purple: { cells: '4', priceAverage: '1' } });

    const result = calculateEstimationResult({
      state,
      predictionGroupKeys: ['purple'],
      collectibleItemsByGroup: { purple: realPurpleItems },
    });

    expect(result.type).toBe('direct');
  });
  ```

- [ ] **Step 3: Run tests to verify the regression test fails and the updated test still passes**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: regression test FAILS (type is 'empty'); updated existing test still PASSES.

- [ ] **Step 4: Pass `predictionGroupKeys` as 4th arg in `calculateEstimationResult`**

  In `src/ethan/estimation-worker-core.js` at the `applyAveragePriceCellMatchOverridesForWorker` call (line ~105):

  ```js
  const averagePriceMatch = applyAveragePriceCellMatchOverridesForWorker(
    state,
    collectibleItemsByGroup,
    resolvedGroups,
    predictionGroupKeys
  );
  ```

- [ ] **Step 5: Run tests to verify both pass**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: all PASS

- [ ] **Step 6: Commit**

  ```bash
  git add src/ethan/estimation-worker-core.js src/ethan/estimator.test.js
  git commit -m "$(cat <<'EOF'
  feat: skip prediction groups from sync cell match so they produce formula pricing

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: `runPriceMatchPhase` — direct branch + combined early-return

**Files:**
- Modify: `src/ethan/estimation-worker-core.js` (add import, add function)
- Modify: `src/ethan/estimator.test.js` (add import, add 3 tests)

- [ ] **Step 1: Add `PER_CELL_EXPECTED` to the import from `estimator.js` and `runPriceMatchPhase` to the test import**

  In `src/ethan/estimation-worker-core.js`, add `PER_CELL_EXPECTED` to the import at line 1:

  ```js
  import {
    ESTIMATION_GROUPS,
    PER_CELL_EXPECTED,
    cloneStateWithGroupCandidates,
    cloneStateWithGroupCells,
    estimateGroupValue,
    estimateTotalByStage,
    findTotalForAveragePrice,
    findFirstAveragePriceCellMatch,
    getEffectiveMaxCells,
    getAverageOnlyPredictions,
    getCombinedAverageOnlyPredictions,
    getPossibleCellsFromAverage,
    getRoundedTarget,
    hasMatchingAveragePriceCombination,
    parseComboOutputLine,
  } from './estimator.js';
  ```

  In `src/ethan/estimator.test.js`, add `PER_CELL_EXPECTED` to the estimator.js import and add `runPriceMatchPhase` to the estimation-worker-core.js import:

  ```js
  import {
    ESTIMATION_GROUPS,
    PER_CELL_EXPECTED,
    // ... all existing imports unchanged
  } from './estimator.js';
  import {
    DEFAULT_ESTIMATION_OUTPUT_LIMIT,
    applyAveragePriceCellMatchOverridesForWorker,
    calculateEstimationResult,
    runPriceMatchPhase,
  } from './estimation-worker-core.js';
  ```

- [ ] **Step 2: Write the three failing tests (spec tests 1, 3, 4)**

  Add a new `describe` block in `src/ethan/estimator.test.js` after the `describe('Ethan worker estimation core', ...)` block:

  ```js
  describe('runPriceMatchPhase', () => {
    it('posts price-match-update with correct delta for a direct result', () => {
      // purple cells=4, priceAverage=8974, count=null → findFirstAveragePriceCellMatch → count=1, totalPrice=8974
      // baseline = 4 * PER_CELL_EXPECTED.purple (count is null so formula path)
      // delta = 8974 − 4 * 2482 = −954
      const state = collect({}, { purple: { cells: '4', priceAverage: '8974' } });
      const result = { type: 'direct', state };
      const posted = [];

      runPriceMatchPhase({
        result,
        state,
        collectibleItemsByGroup: { purple: realPurpleItems },
        predictionGroupKeys: ['purple', 'orange'],
        profile: null,
        runId: 42,
        postMessage: (msg) => posted.push(msg),
      });

      const updates = posted.filter((m) => m.type === 'price-match-update');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        type: 'price-match-update',
        runId: 42,
        groupKey: 'purple',
        rowIndex: null,
        delta: 8974 - 4 * PER_CELL_EXPECTED.purple,
      });
      expect(posted.at(-1)).toEqual({ type: 'price-match-done', runId: 42 });
    });

    it('posts only price-match-done when no combination satisfies the price constraint', () => {
      // priceAverage=1 — cheaper than any real purple item
      const state = collect({}, { purple: { cells: '4', priceAverage: '1' } });
      const result = { type: 'direct', state };
      const posted = [];

      runPriceMatchPhase({
        result,
        state,
        collectibleItemsByGroup: { purple: realPurpleItems },
        predictionGroupKeys: ['purple'],
        profile: null,
        runId: 1,
        postMessage: (msg) => posted.push(msg),
      });

      expect(posted.filter((m) => m.type === 'price-match-update')).toHaveLength(0);
      expect(posted).toEqual([{ type: 'price-match-done', runId: 1 }]);
    });

    it('posts only price-match-done for combined result type without searching', () => {
      const result = { type: 'combined' };
      const posted = [];

      runPriceMatchPhase({
        result,
        state: collect({}),
        collectibleItemsByGroup: {},
        predictionGroupKeys: ['purple'],
        profile: null,
        runId: 5,
        postMessage: (msg) => posted.push(msg),
      });

      expect(posted).toEqual([{ type: 'price-match-done', runId: 5 }]);
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: 3 new tests FAIL — `runPriceMatchPhase is not a function`.

- [ ] **Step 4: Implement `runPriceMatchPhase` with direct branch and combined early-return**

  Add this exported function at the end of `src/ethan/estimation-worker-core.js`:

  ```js
  export function runPriceMatchPhase({
    result,
    state,
    collectibleItemsByGroup,
    predictionGroupKeys,
    profile,
    runId,
    postMessage,
  }) {
    if (result.type !== 'direct' && result.type !== 'single') {
      postMessage({ type: 'price-match-done', runId });
      return;
    }

    for (const groupKey of predictionGroupKeys) {
      const priceAverage = state.groups[groupKey]?.priceAverage;
      if (priceAverage == null) continue;
      const items = collectibleItemsByGroup[groupKey] ?? [];
      if (!items.length) continue;

      if (result.type === 'direct') {
        const groupState = state.groups[groupKey];
        const cells = groupState?.cells;
        if (cells == null) continue;
        if (groupState?.valueSource === 'totalPrice') continue;

        const count = groupState?.count ?? null;
        let totalPrice = null;
        if (count !== null) {
          const tp = findTotalForAveragePrice(priceAverage, count);
          if (tp !== null && hasMatchingAveragePriceCombination(items, { count, cells }, priceAverage)) {
            totalPrice = tp;
          }
        } else {
          const match = findFirstAveragePriceCellMatch(items, cells, priceAverage);
          if (match) totalPrice = match.totalPrice;
        }

        if (totalPrice === null) continue;

        const oldValue = Number.isFinite(groupState?.valueOverride)
          ? groupState.valueOverride
          : (count !== null && count > 0)
            ? priceAverage * count
            : cells * (profile?.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0);
        postMessage({ type: 'price-match-update', runId, groupKey, rowIndex: null, delta: totalPrice - oldValue });
      }
    }

    postMessage({ type: 'price-match-done', runId });
  }
  ```

- [ ] **Step 5: Run tests to verify they pass**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: all PASS

- [ ] **Step 6: Commit**

  ```bash
  git add src/ethan/estimation-worker-core.js src/ethan/estimator.test.js
  git commit -m "$(cat <<'EOF'
  feat: add runPriceMatchPhase with direct branch and combined early-return

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: `runPriceMatchPhase` — single branch

**Files:**
- Modify: `src/ethan/estimation-worker-core.js` (add single branch inside `runPriceMatchPhase`)
- Modify: `src/ethan/estimator.test.js` (add test 2)

- [ ] **Step 1: Write the failing test (spec test 2)**

  Add inside the `describe('runPriceMatchPhase', ...)` block:

  ```js
  it('posts price-match-update with numeric rowIndex for each matched single-result row', () => {
    // purple avg=4 with totalCells=4 → exactly one candidate: cells=4, count=1
    // hasMatchingAveragePriceCombination(realPurpleItems, {count:1, cells:4}, 8974) is true
    // (confirmed by the direct-match test above)
    const state = collect(
      { totalCells: '4' },
      { purple: { avg: '4', priceAverage: '8974' } }
    );
    const result = calculateEstimationResult({
      state,
      predictionGroupKeys: ['purple', 'orange'],
      limit: 10,
    });
    expect(result.type).toBe('single');
    expect(result.rows).toHaveLength(1);

    const posted = [];
    runPriceMatchPhase({
      result,
      state,
      collectibleItemsByGroup: { purple: realPurpleItems },
      predictionGroupKeys: ['purple', 'orange'],
      profile: null,
      runId: 1,
      postMessage: (msg) => posted.push(msg),
    });

    const updates = posted.filter((m) => m.type === 'price-match-update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: 'price-match-update',
      runId: 1,
      groupKey: 'purple',
      rowIndex: 0,
    });
    expect(posted.at(-1)).toEqual({ type: 'price-match-done', runId: 1 });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: FAIL — no update posted (single branch not yet implemented).

- [ ] **Step 3: Add the single branch inside `runPriceMatchPhase`**

  Inside the `for (const groupKey of predictionGroupKeys)` loop in `runPriceMatchPhase`, after the closing `}` of the `if (result.type === 'direct')` block, add:

  ```js
      if (result.type === 'single') {
        for (let i = 0; i < result.rows.length; i++) {
          const rowItem = result.rows[i].item;
          const candidate = rowItem.candidatesByGroup[groupKey];
          const groupState = rowItem.state.groups[groupKey];

          let count, cells;
          if (candidate !== undefined) {
            count = candidate.count;
            cells = candidate.cells;
          } else {
            cells = groupState?.cells;
            count = groupState?.count ?? null;
            if (cells == null) continue;
          }

          if (groupState?.valueSource === 'totalPrice') continue;

          let totalPrice = null;
          if (count !== null) {
            const tp = findTotalForAveragePrice(priceAverage, count);
            if (tp !== null && hasMatchingAveragePriceCombination(items, { count, cells }, priceAverage)) {
              totalPrice = tp;
            }
          } else {
            const match = findFirstAveragePriceCellMatch(items, cells, priceAverage);
            if (match) totalPrice = match.totalPrice;
          }

          if (totalPrice === null) continue;

          const oldValue = Number.isFinite(groupState?.valueOverride)
            ? groupState.valueOverride
            : (count !== null && count > 0)
              ? priceAverage * count
              : cells * (profile?.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0);
          postMessage({ type: 'price-match-update', runId, groupKey, rowIndex: i, delta: totalPrice - oldValue });
        }
      }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/ethan/estimator.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: all PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/ethan/estimation-worker-core.js src/ethan/estimator.test.js
  git commit -m "$(cat <<'EOF'
  feat: add single-result branch to runPriceMatchPhase

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Wire `runPriceMatchPhase` into `estimation-worker.js`

**Files:**
- Modify: `src/ethan/estimation-worker.js:1-6` (import)
- Modify: `src/ethan/estimation-worker.js:89-108` (call before `done`)

- [ ] **Step 1: Add `runPriceMatchPhase` to the import**

  In `src/ethan/estimation-worker.js`:

  ```js
  import {
    appendStreamRunSource,
    calculateEstimationResult,
    createStreamRun,
    finishStreamRun,
    runPriceMatchPhase,
  } from './estimation-worker-core.js';
  ```

- [ ] **Step 2: Call `runPriceMatchPhase` before `done` in both branches**

  Replace lines 89–108 with:

  ```js
    const result = calculateEstimationResult(message);
    if (result.type === 'combined' || result.type === 'single') {
      const { type: mode, rows, ...startPayload } = result;
      self.postMessage({ type: 'start', runId, mode, ...startPayload, count: rows.length });
      rows.forEach((row, index) => {
        self.postMessage({
          type: 'row',
          runId,
          mode,
          index: index + 1,
          groupKeys: result.groupKeys,
          groupKey: result.groupKey,
          ...row,
        });
      });
      runPriceMatchPhase({
        result,
        state: message.state,
        collectibleItemsByGroup: message.collectibleItemsByGroup,
        predictionGroupKeys: message.predictionGroupKeys,
        profile: message.profile,
        runId,
        postMessage: self.postMessage.bind(self),
      });
      self.postMessage({ type: 'done', runId });
      return;
    }

    self.postMessage({ type: 'result', runId, result });
    runPriceMatchPhase({
      result,
      state: message.state,
      collectibleItemsByGroup: message.collectibleItemsByGroup,
      predictionGroupKeys: message.predictionGroupKeys,
      profile: message.profile,
      runId,
      postMessage: self.postMessage.bind(self),
    });
    self.postMessage({ type: 'done', runId });
  ```

- [ ] **Step 3: Run the full test suite to catch regressions**

  ```bash
  npx vitest run --reporter=verbose 2>&1 | tail -40
  ```

  Expected: all existing tests PASS

- [ ] **Step 4: Commit**

  ```bash
  git add src/ethan/estimation-worker.js
  git commit -m "$(cat <<'EOF'
  feat: call runPriceMatchPhase in estimation worker before posting done

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Panel `runEstimationSync` — exclude prediction groups + update existing test

**Files:**
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js:374-394` (update existing test)
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js:1407-1413` (update `needsAveragePriceCombination`)

- [ ] **Step 1: Update the existing test at line 374**

  The current test expects `补充件数` when purple has cells+priceAverage and Worker is unavailable. After the fix, prediction groups no longer trigger that error — formula pricing is shown instead.

  Replace the test (currently titled `'tells users to fill count manually when average-price cell matching needs a Worker'`) with:

  ```js
  it('shows formula pricing for prediction groups with priceAverage when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');

    await wrapper.find('#estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    // Prediction groups (purple) no longer trigger the "needs Worker" gate;
    // runEstimationSync skips them so formula pricing is shown directly.
    expect(wrapper.find('#result-meta').text()).not.toContain('补充件数');
    expect(wrapper.find('#total-estimate').text()).toBe('17,374');
  });
  ```

  *(17374 = 7 × perCellExpected.purple = 7 × 2482)*

- [ ] **Step 2: Run the updated test to verify it fails**

  ```bash
  npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: FAIL — still sees `补充件数`.

- [ ] **Step 3: Update `needsAveragePriceCombination` in `runEstimationSync`**

  In `src/hero-estimator/useHeroEstimatorPanel.js`, replace lines 1407–1413:

  ```js
  const predictionGroupKeySet = new Set(predictionConfigs.map((c) => c.groupKey));
  const needsAveragePriceCombination = groups.some((group) => {
    if (predictionGroupKeySet.has(group.key)) return false;
    const input = baseState.groups[group.key];
    return input?.cells !== null
      && input.priceAverage !== null
      && input.count === null
      && !Number.isFinite(input.valueOverride);
  });
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js
  git commit -m "$(cat <<'EOF'
  feat: exclude prediction groups from sync needsAveragePriceCombination check

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Panel — `groupKey` on direct rows, `price-match` message handlers, tests 6–8

**Files:**
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js` (3 changes)
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js` (3 new tests)

- [ ] **Step 1: Write the three failing tests (spec tests 6, 7, 8)**

  Add inside `describe('HeroEstimatorPanel', ...)` in `src/hero-estimator/HeroEstimatorPanel.test.js`:

  ```js
  it('applies price-match-update delta to direct result row and summary', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');

    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    // Formula: 7 × perCellExpected.purple (2482) = 17374
    expect(wrapper.find('#total-estimate').text()).toBe('17,374');

    const worker = getLatestEstimationWorker();
    worker.onmessage({ data: { type: 'price-match-update', runId: 1, groupKey: 'purple', rowIndex: null, delta: 1000 } });
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe('18,374');
  });

  it('applies price-match-update delta to prediction row and updates summary when rowIndex is 0', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#avg-purple').setValue('2');

    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    const initialTotal = parseInt(wrapper.find('#total-estimate').text().replace(/,/g, ''), 10);
    expect(Number.isFinite(initialTotal)).toBe(true);

    const worker = getLatestEstimationWorker();
    worker.onmessage({ data: { type: 'price-match-update', runId: 1, groupKey: 'purple', rowIndex: 0, delta: 2000 } });
    await nextTick();

    const afterTotal = parseInt(wrapper.find('#total-estimate').text().replace(/,/g, ''), 10);
    expect(afterTotal - initialTotal).toBe(2000);
  });

  it('ignores price-match-update with a stale runId from a previous estimation', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');

    // First submission: runId=1
    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    // Second submission: runId=2
    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    const totalAfterSecond = wrapper.find('#total-estimate').text();

    // Stale message from first worker (runId=1); estimationRunId is now 2
    const firstWorker = FakeEstimationWorker.instances[0];
    firstWorker.onmessage({ data: { type: 'price-match-update', runId: 1, groupKey: 'purple', rowIndex: null, delta: 5000 } });
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe(totalAfterSecond);
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: 3 new tests FAIL.

- [ ] **Step 3: Add `groupKey` to direct rows in `renderWorkerResult`**

  In `src/hero-estimator/useHeroEstimatorPanel.js`, inside `renderWorkerResult`, change the map at line ~965. Currently it computes `groupKey` locally but does not include it in the returned object:

  ```js
  // Before:
  return { ...row, label: t(row.labelKey), status: t(row.statusKey) + priceErrorText };

  // After:
  return { ...row, groupKey, label: t(row.labelKey), status: t(row.statusKey) + priceErrorText };
  ```

- [ ] **Step 4: Add `applyPriceMatchUpdate` helper function**

  Add this function after `renderWorkerResult` in `src/hero-estimator/useHeroEstimatorPanel.js`:

  ```js
  function applyPriceMatchUpdate(message) {
    const { groupKey, rowIndex, delta } = message;
    if (rowIndex === null) {
      const row = tableRows.value.find((r) => r.groupKey === groupKey);
      if (!row) return;
      row.mean += delta;
      row.low += delta;
      row.high += delta;
      summary.total += delta;
      summary.low += delta;
      summary.high += delta;
    } else {
      const row = tableRows.value[rowIndex];
      if (!row) return;
      row.mean += delta;
      row.low += delta;
      row.high += delta;
      if (rowIndex === 0) {
        summary.total += delta;
        summary.low += delta;
        summary.high += delta;
      }
    }
  }
  ```

- [ ] **Step 5: Add `price-match-update` and `price-match-done` handlers in `handleEstimationWorkerMessage`**

  In `src/hero-estimator/useHeroEstimatorPanel.js`, inside `handleEstimationWorkerMessage`, add before the `if (message.type === 'done')` block (line ~1162):

  ```js
  if (message.type === 'price-match-update') {
    applyPriceMatchUpdate(message);
    return;
  }
  if (message.type === 'price-match-done') {
    return;
  }
  ```

- [ ] **Step 6: Run tests to verify all three pass**

  ```bash
  npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js --reporter=verbose 2>&1 | tail -20
  ```

  Expected: all PASS

- [ ] **Step 7: Run the full test suite to confirm no regressions**

  ```bash
  npx vitest run --reporter=verbose 2>&1 | tail -40
  ```

  Expected: all PASS

- [ ] **Step 8: Commit**

  ```bash
  git add src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js
  git commit -m "$(cat <<'EOF'
  feat: patch row prices reactively from async price-match-update Worker messages

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```
