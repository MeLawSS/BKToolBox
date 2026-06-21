# Ethan Expected Value: Skip Combined Predictions When All Prediction Groups Lack Cells — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress multi-group combination in two paths: (1) `getCombinedAverageOnlyPredictions` when all prediction groups lack cells, (2) price-only stream companion when an earlier prediction group also lacks cells.

**Architecture:** Guard 1 lives inside `getCombinedAverageOnlyPredictions` (single source of truth). Guard 2 lives in `runEstimation()` before `startPriceOnlySearch`, checking whether an earlier prediction-config group also has `cells === null`. Both guards derive from prediction configs, not hardcoded group keys.

**Tech Stack:** Vitest + @vue/test-utils (happy-dom), vanilla JS guard logic

**Current state:** Guard 1 is already implemented in `src/ethan/estimator.js` with tests passing (47/47). Guard 2 is the remaining work.

---

## File Structure

| File | Role |
|------|------|
| `src/hero-estimator/useHeroEstimatorPanel.js:1618-1622` | Guard 2 — skip price-only stream when earlier group lacks cells |
| `src/hero-estimator/HeroEstimatorPanel.test.js` | Panel test with Worker stub — exercises price-only suppression path |

---

### Task 1: Price-only stream suppression guard + panel test

**Files:**
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js:1618-1622`
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js` — add test

- [ ] **Step 1: Write the failing test in `HeroEstimatorPanel.test.js`**

Insert in the `describe('HeroEstimatorPanel', ...)` block:

```js
  it('skips price-only stream search when an earlier prediction group also lacks cells', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    // Fill total cells
    await wrapper.find('#total-cells-all').setValue('120');
    // Fill purple avg only (cells empty)
    await wrapper.find('#avg-purple').setValue('3');
    // Fill orange priceAverage only (avg and cells empty)
    await wrapper.find('#price-orange').setValue('20000');

    await wrapper.find('#estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    // Under current code, price-only stream search fires for orange
    // and attaches purple as companion → combined-like output.
    // After fix, stream is skipped → falls to worker → purple individual list.
    // Verify no stream run was started for orange price-only search.
    const runSources = getRunSources();
    const priceStreamSources = runSources.filter(
      (source) => String(source.url).includes('solve-gold-combo.js')
    );
    expect(priceStreamSources.length).toBe(0);

    // Verify purple individual predictions are shown (not combined).
    const metaEl = wrapper.find('#result-meta');
    expect(metaEl.exists()).toBe(true);
    expect(metaEl.text()).not.toContain('、');
    expect(metaEl.text()).toContain('紫');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd W:\BidKing && npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js -t "skips price-only stream" 2>&1 | tail -10
```

Expected: FAIL — `priceStreamSources.length` is 1 (stream search launched).

- [ ] **Step 3: Add the guard in `useHeroEstimatorPanel.js`**

In `runEstimation()`, modify the price-only search loop (currently lines ~1618-1622):

Current code:
```js
    for (const config of predictionConfigs) {
      if (isPriceOnlyState(state, config) && startPriceOnlySearch(state, config)) {
        return;
      }
    }
```

Replace with:
```js
    for (const config of predictionConfigs) {
      if (isPriceOnlyState(state, config)) {
        // When an earlier prediction group also lacks cells, skip the
        // price-only stream — its companion logic would combine groups.
        // Let the flow fall through to the worker/sync path where the
        // earlier group's individual predictions will be shown.
        const configIndex = predictionConfigs.indexOf(config);
        const hasEarlierGroupMissingCells = predictionConfigs
          .slice(0, configIndex)
          .some(c => state.groups[c.groupKey]?.cells === null);
        if (!hasEarlierGroupMissingCells && startPriceOnlySearch(state, config)) {
          return;
        }
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd W:\BidKing && npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js -t "skips price-only stream" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run full panel test suite to check for regressions**

```bash
cd W:\BidKing && npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 6: Run estimator tests to confirm no regressions**

```bash
cd W:\BidKing && npx vitest run src/ethan/estimator.test.js 2>&1 | tail -5
```

Expected: 47/47 PASS.

- [ ] **Step 7: Commit**

```bash
cd W:\BidKing && git add src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js && git commit -m "feat: skip price-only stream search when earlier prediction group lacks cells"
```

---

### Task 2: Final verification

- [ ] **Step 1: Run all related test suites**

```bash
cd W:\BidKing && npx vitest run src/ethan/estimator.test.js src/hero-estimator/HeroEstimatorPanel.test.js 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 2: Commit any remaining changes (if needed)**

```bash
cd W:\BidKing && git status
```
