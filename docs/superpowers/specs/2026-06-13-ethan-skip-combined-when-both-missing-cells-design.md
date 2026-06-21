# Ethan Expected Value: Skip Combined Predictions When All Prediction Groups Lack Total Cells

**Date:** 2026-06-13 (updated 2026-06-14)
**Scope:** `src/ethan/estimator.js`, `src/hero-estimator/useHeroEstimatorPanel.js`, `src/ethan/estimation-worker-core.js`

## Goal

When **all** groups in the current prediction configs lack total cell count input — whether they have average grid count (avg) OR average price (priceAverage) — skip any form of multi-group combination and fall through directly to the individual prediction loop (purple first for Ethan).

There are two distinct combination paths that both need guarding:

1. **Average-cells combined path:** `getCombinedAverageOnlyPredictions()` — combines purple + orange avg-only candidates. Triggered when both groups have `avg !== null, cells === null, totalCells !== null`.

2. **Price-only stream companion path:** `startPriceOnlySearch()` + `getPredictionCompanion()` — when a later group (orange) is price-only, it attaches an earlier avg-only group (purple) as a companion to every result row. Triggered when orange has `priceAverage !== null, avg === null, cells === null` AND purple has `avg !== null, cells === null`.

Both paths produce multi-group combination output, and both should be suppressed when the respective groups lack explicit cell input.

### Why the guard checks only `cells === null` (and `monitorKnownCells`)

The guard intentionally omits `avg !== null` and `totalCells !== null` checks. When those conditions are also absent, the combined/companion paths already produce no results, so skipping them is a no-op.

## Non-Goals

- Total-price search path — unchanged
- Direct estimation path — unchanged
- Elsa page — only has one prediction config, combined/companion never triggers regardless
- Other groups (wg, blue, red) — not part of prediction configs

## Target Behavior

1. When all prediction-config groups have `cells === null` AND no `monitorKnownCells`: skip both `getCombinedAverageOnlyPredictions()` and the price-only stream companion path; proceed to individual prediction loop (Ethan: tries purple first, then orange)
2. When any prediction-config group has `cells !== null` or `monitorKnownCells > 0`: current behavior unchanged
3. Elsa (single prediction config): guard is a no-op since combined requires ≥2 candidate lists and companion requires an earlier config

## Design

### Guard 1: Inside `getCombinedAverageOnlyPredictions` (`estimator.js`)

Early return before candidate generation:

```js
if (
  groupKeys.length >= 2
  && groupKeys.every((key) => {
    const g = state.groups[key];
    return g?.cells === null && !(g?.monitorKnownCells > 0);
  })
) {
  return [];
}
```

This is the single source of truth — no duplication in callers.

### Guard 2: Before `startPriceOnlySearch` (`useHeroEstimatorPanel.js`)

In `runEstimation()`, before launching the price-only stream search for a config, check whether an earlier prediction-config group also lacks cells. If so, skip the stream search and let the flow fall through to the worker/sync path where the earlier group's individual predictions will be shown:

```js
for (const config of predictionConfigs) {
  if (isPriceOnlyState(state, config)) {
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

This prevents the price-only stream from attaching purple as a companion when purple also lacks cells.

### Edge Cases

| Case | Behavior |
|------|----------|
| Purple avg, orange avg, both no cells | Guard 1: skip combined → purple individual list |
| Purple avg, orange priceAverage, both no cells | Guard 2: skip stream companion → purple individual list |
| Orange priceAverage, purple no input | Guard 2: no earlier group missing cells → stream runs normally |
| Purple cells filled, orange priceAverage | Guard 2: purple has cells → stream runs normally (no companion since purple cells known) |
| Purple avg, orange no cells, both no cells, blue has monitorKnownCells | Guard 1: blue not a prediction config → not checked; purple+orange both no cells → skip combined |

## Files Changed

- `src/ethan/estimator.js` — Guard 1 inside `getCombinedAverageOnlyPredictions`
- `src/hero-estimator/useHeroEstimatorPanel.js` — Guard 2 inside `runEstimation()` price-only loop
- `src/ethan/estimation-worker-core.js` — (unchanged; Guard 1 covers worker path transitively)

## Testing

### 1. Guard 1: Direct unit test in `src/ethan/estimator.test.js`

Call `getCombinedAverageOnlyPredictions()` with both groups missing cells. Assert returns `[]`.

### 2. Guard 1: Sync fallback panel test in `src/hero-estimator/HeroEstimatorPanel.test.js`

Mount without Worker stub. Fill totalCells, purple avg, orange avg (both cells empty). Assert individual purple output.

### 3. Guard 2: Price-only stream suppression test in `src/hero-estimator/HeroEstimatorPanel.test.js`

Mount with Worker stub. Fill totalCells, purple avg, orange priceAverage (both cells empty). Assert the price-only stream is NOT started (no stream run launched), and purple individual predictions are shown instead.
