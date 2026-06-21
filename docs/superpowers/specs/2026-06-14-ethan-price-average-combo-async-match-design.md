# Ethan/Elsa: Async Price-Average Combination Match for Purple and Gold

**Date:** 2026-06-14
**Scope:** `src/ethan/estimation-worker-core.js`, `src/ethan/estimation-worker.js`, `src/hero-estimator/useHeroEstimatorPanel.js`

## Goal

When purple or gold has `priceAverage` set, find a real item combination whose total price matches the average-price constraint, and replace the initial estimated price with the combination's actual market price. The search runs in the background Worker after the initial result is already displayed; the UI updates reactively when a match is found. 

## Non-Goals

- Other groups (wg, blue, red) — `applyAveragePriceCellMatchOverridesForWorker` continues to handle them synchronously as before
- Groups where the user explicitly set a total price (`valueSource === 'totalPrice'`) — their `valueOverride` is a deliberate user choice; async match is skipped for those groups
- `type: 'combined'` result rows — not handled in this iteration
- Elsa profile — has only one prediction config group; `type: 'combined'` never fires; `type: 'single'` and `type: 'direct'` are handled the same way as Ethan
- Sync fallback path (`runEstimationSync`) — still present at line 1402; the async price-match phase runs only in the Worker. The sync path must also be updated to exclude prediction groups from its `needsAveragePriceCombination` guard so they can display formula pricing when no Worker is available

## Trigger Conditions

Price-match phase runs for a group when **all** of:
1. The group is a prediction-config group (purple or gold/orange for Ethan)
2. `state.groups[groupKey].priceAverage !== null`
3. `collectibleItemsByGroup[groupKey]` is non-empty
4. Result type is `'direct'` or `'single'`

For `'direct'`: the group must also have `cells !== null` (otherwise there is nothing to match against).
For `'single'`: each prediction row provides its own `cells` value; groups whose `cells` is still null in that row's state are skipped.

Groups with `valueSource === 'totalPrice'` are always skipped — that is a user-explicit price, not an estimate. Groups with monitor-derived `valueOverride` (`valueSource === 'monitorOutlines'` or the `cloneStateWithGroupCells` monitor path which sets `valueOverride` without a `valueSource`) are included: they represent monitor+formula estimates, exactly what this feature replaces. Their `valueOverride` is used as the delta baseline.

## Data Flow

```
User submits estimation (purple/gold has priceAverage)
        │
        ▼
applyAveragePriceCellMatchOverridesForWorker
  - Skips prediction-config groups (purple, gold) via skipGroupKeys param
  - All other groups handled synchronously as before
        │
        ▼
calculateEstimationResult (Worker)
  - Purple/gold priced at their initial estimated value (formula or valueOverride)
        │
        ▼
estimation-worker.js posts initial result messages:
  'single': start → row × N
  'direct': result
  (done NOT yet sent)
        │
        ├──► Panel renders immediately (formula prices)
        │
        ▼
runPriceMatchPhase (called in estimation-worker.js before posting 'done')
  For each predictionConfig group with priceAverage:
    'direct': match against state.groups[groupKey].cells
    'single': match against each row's candidate.cells (skip if null)
    On match → post { type: 'price-match-update', runId, groupKey, rowIndex, delta }
  All done → post { type: 'price-match-done', runId }
        │
        ▼
estimation-worker.js posts { type: 'done', runId }  ← Worker termination signal
        │
Panel handles price-match-update before done:
  patches row price + recalculates summary
Panel handles done:
  terminates Worker as now
```

**Why price-match runs before `done`:** the panel terminates the Worker on `done`. All `price-match-update` messages must be sent before `done` to guarantee delivery before termination. Message order is FIFO, so panel processes updates in sequence.

## Design

### Modified: `applyAveragePriceCellMatchOverridesForWorker` in `estimation-worker-core.js`

Add a `skipGroupKeys` parameter (default `[]`). At the top of the group loop:

```js
if (skipGroupKeys.includes(group.key)) continue;
```

Callers pass `predictionGroupKeys` as `skipGroupKeys` so purple/gold are excluded from the synchronous match. No other change to this function.

**Note:** `calculateEstimationResult` in `estimation-worker-core.js` (line 105) is the sole call site of `applyAveragePriceCellMatchOverridesForWorker`. No change to `useHeroEstimatorPanel.js` is needed for this.

### New: `runPriceMatchPhase` in `estimation-worker-core.js`

```js
function runPriceMatchPhase({
  result,                  // calculateEstimationResult return value
  state,                   // matched state (post applyAveragePriceCellMatchOverridesForWorker)
  collectibleItemsByGroup, // already present in Worker 'start' message
  predictionGroupKeys,
  profile,                 // passed through from Worker 'start' message; may be null
  runId,
  postMessage,             // self.postMessage.bind(self) from estimation-worker.js
})
```

**Logic:**

The function requires `profile` (from the Worker `message`, may be null) for the formula baseline.

```
if result.type not in ['direct', 'single'] → skip to postMessage({ type: 'price-match-done', runId })

for each groupKey of predictionGroupKeys:
  const priceAverage = state.groups[groupKey]?.priceAverage
  if priceAverage === null → skip
  const items = collectibleItemsByGroup[groupKey] ?? []
  if items.length === 0 → skip

  if result.type === 'direct':
    const groupState = state.groups[groupKey]
    const cells = groupState?.cells
    if cells === null → skip
    // Skip only when the user explicitly set a total price for this group (valueSource === 'totalPrice').
    // Monitor-derived overrides (valueSource === 'monitorOutlines', or no valueSource from
    // cloneStateWithGroupCells monitor path) are still formula/monitor estimates — exactly
    // what this feature is meant to replace.
    if groupState?.valueSource === 'totalPrice' → skip

    // count may be non-null if user provided both avg and cells (deriveCountFromCells ran during state build)
    const count = groupState?.count ?? null

    // Count-constrained search when count is known; unconstrained otherwise
    let totalPrice = null
    if count !== null:
      const tp = findTotalForAveragePrice(priceAverage, count)
      if tp !== null && hasMatchingAveragePriceCombination(items, { count, cells }, priceAverage):
        totalPrice = tp
    else:
      const match = findFirstAveragePriceCellMatch(items, cells, priceAverage)
      if match: totalPrice = match.totalPrice

    if totalPrice === null → skip

    // Baseline exactly mirrors computeGroupValue: valueOverride first, then formula
    const oldValue = Number.isFinite(groupState?.valueOverride)
      ? groupState.valueOverride  // monitor-derived estimate; correctly tracks the displayed value
      : (priceAverage !== null && count !== null && count > 0)
        ? priceAverage * count
        : cells * (profile?.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0)
    postMessage({ type: 'price-match-update', runId, groupKey, rowIndex: null, delta: totalPrice - oldValue })

  if result.type === 'single':
    for (let i = 0; i < result.rows.length; i++):
      const rowItem = result.rows[i].item
      const candidate = rowItem.candidatesByGroup[groupKey]
      const groupState = rowItem.state.groups[groupKey]

      let count, cells
      if candidate !== undefined:
        // Enumerated group: exact candidate values
        count = candidate.count   // always non-null (cloneStateWithGroupCells copies it)
        cells = candidate.cells
      else:
        // Non-enumerated group with fixed cells+priceAverage (stored only in state)
        cells = groupState?.cells
        count = groupState?.count ?? null
        if cells === null → skip  // no cells to match against

      // Skip only when the user explicitly set a total price (valueSource === 'totalPrice').
      if groupState?.valueSource === 'totalPrice' → skip

      let totalPrice = null
      if count !== null:
        // Count-constrained search (enumerated group always here; non-enumerated if count derived)
        const tp = findTotalForAveragePrice(priceAverage, count)
        if tp !== null && hasMatchingAveragePriceCombination(items, { count, cells }, priceAverage):
          totalPrice = tp
      else:
        // count unknown: unconstrained search (non-enumerated group, no avg provided)
        const match = findFirstAveragePriceCellMatch(items, cells, priceAverage)
        if match: totalPrice = match.totalPrice

      if totalPrice === null → skip

      // Baseline exactly mirrors computeGroupValue: valueOverride first, then formula
      const oldValue = Number.isFinite(groupState?.valueOverride)
        ? groupState.valueOverride  // monitor-derived estimate
        : (priceAverage !== null && count !== null && count > 0)
          ? priceAverage * count
          : cells * (profile?.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0)
      postMessage({ type: 'price-match-update', runId, groupKey, rowIndex: i, delta: totalPrice - oldValue })

postMessage({ type: 'price-match-done', runId })
```

`findTotalForAveragePrice` and `hasMatchingAveragePriceCombination` are already imported in `estimation-worker-core.js`. `PER_CELL_EXPECTED` must be added to the import from `estimator.js` (needed only in the direct-branch fallback).

**`rowIndex` encoding:** `null` means `'direct'` result (one group row per group); a number means `'single'` result (one prediction row per index). The panel uses this to select patching strategy without a separate result-type ref.

### Modified: `estimation-worker.js` — insertion point for `runPriceMatchPhase`

Current structure (lines 84–116):
```js
if (result.type === 'combined' || result.type === 'single') {
  self.postMessage({ type: 'start', ... });
  rows.forEach(...);
  self.postMessage({ type: 'done', runId });   // ← currently final
  return;
}
self.postMessage({ type: 'result', runId, result });
self.postMessage({ type: 'done', runId });     // ← currently final
```

After change:
```js
if (result.type === 'combined' || result.type === 'single') {
  self.postMessage({ type: 'start', ... });
  rows.forEach(...);
  runPriceMatchPhase({ result, state: message.state, collectibleItemsByGroup: message.collectibleItemsByGroup, predictionGroupKeys: message.predictionGroupKeys, profile: message.profile, runId, postMessage: self.postMessage.bind(self) });
  self.postMessage({ type: 'done', runId });
  return;
}
self.postMessage({ type: 'result', runId, result });
runPriceMatchPhase({ result, state: message.state, collectibleItemsByGroup: message.collectibleItemsByGroup, predictionGroupKeys: message.predictionGroupKeys, profile: message.profile, runId, postMessage: self.postMessage.bind(self) });
self.postMessage({ type: 'done', runId });
```

`collectibleItemsByGroup` and `predictionGroupKeys` are already present in the Worker `'start'` message (lines 1185–1186 of `useHeroEstimatorPanel.js`).

### New Worker Messages (Worker → Panel)

```js
// Sent once per matched row, before 'done'
{
  type: 'price-match-update',
  runId: number,
  groupKey: string,        // 'purple' | 'orange'
  rowIndex: number | null, // null → 'direct' mode; number → 'single' mode row index
  delta: number,           // totalPrice - formula-baseline; add directly to row.mean/low/high
}

// Sent after all groups/rows are processed, before 'done'
{
  type: 'price-match-done',
  runId: number,
}
```

### Panel: `useHeroEstimatorPanel.js` — prerequisite: expose `groupKey` on direct rows

In `renderWorkerResult`, when mapping `result.groupRows` for 'direct' results, include `groupKey` in each row:

```js
result.groupRows.map((row) => {
  const groupKey = getGroupKeyForWorkerRow(row);
  return { ...row, groupKey, label: t(row.labelKey), status: t(row.statusKey) + priceErrorText };
})
```

This makes it possible to locate a row by group identity in the price-match handler without re-deriving it from `labelKey`.

### Panel: `useHeroEstimatorPanel.js` — `handleEstimationWorkerMessage`

No new reactive refs needed. `rowIndex` encodes the patching strategy.

**On `price-match-update`:** (already guarded by existing `runId !== estimationRunId` check at line 1141)

**`rowIndex === null` → 'direct' result:**
```
const row = tableRows.value.find(r => r.groupKey === message.groupKey)
if (!row) return
row.mean += message.delta
row.low  += message.delta
row.high += message.delta
summary.total += message.delta
summary.low   += message.delta
summary.high  += message.delta
```
`mean/low/high` are the price fields on direct group rows. The Worker computed the delta correctly. Summary is updated by the same delta.

**`rowIndex` is a number → 'single' result:**
```
const row = tableRows.value[message.rowIndex]
if (!row) return
row.mean += message.delta
row.low  += message.delta
row.high += message.delta
// summary was set from the first row; update only when row 0 is patched
if (message.rowIndex === 0) {
  summary.total += message.delta
  summary.low   += message.delta
  summary.high  += message.delta
}
```

The Worker has already computed the correct delta (accounting for whether the row's group used `priceAverage × count` or `cells × perCellExpected` as its formula baseline). The panel just applies it.

**On `price-match-done`:** update meta text if needed (e.g., remove a "searching" indicator). No Worker termination — that still happens on `done`.

**On `done`:** unchanged — terminates Worker and saves state.

## Behavioral Change: Prediction Groups No Longer Hard-Error on No Match

Previously, `applyAveragePriceCellMatchOverridesForWorker` returned `type: 'empty' / priceCellsNoMatch` when a prediction group had `cells !== null && priceAverage !== null` but no real combination was found. That was a hard block — the panel showed nothing.

Under this design:

- Prediction groups (`predictionGroupKeys`) are excluded from the synchronous match via `skipGroupKeys`. They always produce an initial estimated price (formula or valueOverride as appropriate — no error).
- The async search updates the displayed price if a match is found. If no match exists, formula pricing remains permanently — the user sees a result rather than an empty state.
- This applies to both the Worker path and the sync fallback: `runEstimationSync`'s `needsAveragePriceCombination` check must exclude prediction groups so they don't trigger the "no estimation worker support" error when a Worker is unavailable.

Non-prediction groups (wg, blue, red, orange when not a prediction config) retain the existing hard-error behavior.

## Edge Cases

| Case | Behavior |
|---|---|
| priceAverage set but no matching combination | Silent skip; row keeps its initial estimated price; no error shown |
| `collectibleItemsByGroup[groupKey]` absent or empty | `findFirstAveragePriceCellMatch` returns null; silent skip |
| `'direct'` type, cells === null for purple/gold | Skip that group (nothing to match against) |
| `'single'` type, non-enumerated group has cells === null in row state | `if cells === null → skip` handles this; no match attempted for that group/row pair |
| `'single'` type, non-enumerated group has fixed cells + priceAverage | Falls through to non-candidate branch: `cells`/`count` read from `rowItem.state.groups[groupKey]`; same match computed once per row (N identical searches, identical delta); redundancy accepted |
| `'single'` type, a row's cells value is very large | Search is count-constrained (uses `hasMatchingAveragePriceCombination`); no 1..30 loop; bounded by the candidate's own count |
| User resubmits during price-match | New estimation increments `estimationRunId`; existing `runId !== estimationRunId` guard in `handleEstimationWorkerMessage` ignores all stale updates |
| `'combined'` result type | `runPriceMatchPhase` immediately posts `price-match-done` and returns; no price updates |
| Worker unavailable | `startEstimationWorker` returns false; `runEstimationSync` runs instead; prediction groups show formula pricing (updated `needsAveragePriceCombination` excludes them); no async price-match phase |
| priceAverage === null | Group skipped in `runPriceMatchPhase`; no change to existing behavior |
| `valueSource === 'totalPrice'` for a group | Group skipped; user explicitly set a total price — async match would override a deliberate user input |
| `valueOverride` set without `valueSource === 'totalPrice'` (monitor-derived) | Included; `valueOverride` used as baseline (mirrors `computeGroupValue`); async match replaces the monitor+formula estimate with real combination price |
| Panel unmounted during price-match | `cancelActiveCalculations()` called from `onBeforeUnmount`; terminates Worker before further messages arrive |

## Files Changed

- `src/ethan/estimator.js`
  - Add `PER_CELL_EXPECTED` to the symbols exported (it is already exported; ensure `estimation-worker-core.js` imports it)
- `src/ethan/estimation-worker-core.js`
  - Import `PER_CELL_EXPECTED`, `findTotalForAveragePrice`, `hasMatchingAveragePriceCombination` from `estimator.js` (the latter two are already imported; add `PER_CELL_EXPECTED`)
  - `applyAveragePriceCellMatchOverridesForWorker`: add `skipGroupKeys = []` param; skip matching group when `skipGroupKeys.includes(group.key)`
  - `calculateEstimationResult`: pass `predictionGroupKeys` as `skipGroupKeys` to `applyAveragePriceCellMatchOverridesForWorker` (this is the call at line 105; no panel change needed)
  - Add `runPriceMatchPhase` function; computes `delta` Worker-side and posts `price-match-update` / `price-match-done`
- `src/ethan/estimation-worker.js`
  - Call `runPriceMatchPhase` before posting `done`, in both branches; pass `profile: message.profile`
- `src/hero-estimator/useHeroEstimatorPanel.js`
  - `renderWorkerResult`: add `groupKey` field to each direct-result row (via `getGroupKeyForWorkerRow`)
  - `runEstimationSync` (line 1402): in the `needsAveragePriceCombination` check, exclude groups whose key is in `predictionConfigs.map(c => c.groupKey)` so prediction groups always produce formula pricing in the sync path
  - `handleEstimationWorkerMessage`: add `price-match-update` handler (apply `message.delta` to row and summary); add `price-match-done` handler

## Testing

### `src/ethan/estimator.test.js`

1. **`runPriceMatchPhase` — direct, match found**
   Call with `result.type = 'direct'`, purple has `cells` + `priceAverage`, items contain a valid combination. Assert `price-match-update` posted with `rowIndex: null` and correct `delta` (= combination totalPrice − formula baseline); `price-match-done` posted after.

2. **`runPriceMatchPhase` — single, multiple rows**
   Call with `result.type = 'single'`, N prediction rows, one prediction group enumerated and one with fixed cells+priceAverage (non-enumerated). Assert `price-match-update` messages for both groups per row: enumerated group uses candidate count; non-enumerated group reads cells+count from state. A row with no feasible match produces no update. `price-match-done` posted after all rows.

3. **`runPriceMatchPhase` — no match found**
   Items exist but no combination satisfies `priceAverage`. Assert no `price-match-update` posted; only `price-match-done` posted.

4. **`runPriceMatchPhase` — combined type skipped**
   `result.type = 'combined'`. Assert only `price-match-done` is posted (no updates).

5. **`applyAveragePriceCellMatchOverridesForWorker` — skipGroupKeys respected**
   Purple and orange in `skipGroupKeys`. Assert those groups produce no `valueOverride`; a non-skipped group with cells + priceAverage still gets its `valueOverride` set.

### `src/hero-estimator/HeroEstimatorPanel.test.js`

6. **Price-match update patches row and summary (direct)**
   Simulate Worker posting `price-match-update` with `rowIndex: null` and a `delta`. Assert the relevant group row's mean/low/high each change by `delta` and `summary.total` changes by the same amount.

7. **Price-match update patches prediction row (single)**
   Simulate Worker posting `price-match-update` with a numeric `rowIndex` and a `delta`. Assert the row's rendered price changes by `delta` and, if `rowIndex === 0`, the summary total also changes by `delta`.

8. **Stale runId update ignored**
   Submit a new estimation (incrementing `estimationRunId`), then deliver a `price-match-update` with the old `runId`. Assert the displayed values are not patched.
