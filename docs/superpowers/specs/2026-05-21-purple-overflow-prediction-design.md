# Purple Overflow Prediction — Design Spec

Date: 2026-05-21

## Problem

When the user fills in 总格数 + 白绿总格 + 蓝总格 + 紫色均格/均价, the purple prediction is hard-capped at `totalCells - knownCells`. In practice, the total may run slightly over the stated 总格数 (藏品格数可能有误差), so valid purple combinations get excluded. There is also no visual signal when a result would push the total above the stated cap.

## Solution

When wg.cells and blue.cells are both known, relax the purple cell upper bound to `totalCells + 20`. Combinations that exceed the original `totalCells` get a `总格数:x` tag and a distinct row color so the user can tell them apart at a glance.

## Trigger Condition

Relaxation is active when **all** of the following are true:

- `state.totalCells !== null`
- `state.groups.wg.cells !== null`
- `state.groups.blue.cells !== null`

No check on orange/red — if those are also filled they contribute to knownCells normally, and the same +20 relaxation still applies.

## Logic Changes (`src/ethan/estimator.js`)

### New export: `getEffectiveMaxCells(state)`

```js
export function getEffectiveMaxCells(state) {
  if (state.totalCells === null) return null;
  if (state.groups.wg.cells !== null && state.groups.blue.cells !== null) {
    return state.totalCells + 20;
  }
  return state.totalCells;
}
```

Returns the effective total-cells cap for purple candidate generation. When the trigger condition is met, returns `totalCells + 20`; otherwise returns `totalCells` unchanged.

### `getAverageOnlyPredictions` — one line change

```js
// before
const maxGroupCells = state.totalCells - state.knownCells;
// after
const effectiveMax = getEffectiveMaxCells(state);
const maxGroupCells = effectiveMax - state.knownCells;
```

### `getCombinedAverageOnlyPredictions` — two constraint checks

Both occurrences of `> state.totalCells` / `<= state.totalCells` become `> effectiveMax` / `<= effectiveMax`. `effectiveMax` is derived once at the top of the function via `getEffectiveMaxCells(state)`.

## App.vue Changes (`src/ethan/App.vue`)

### `startPriceOnlySearch` — maxGroupCells

```js
// before
const maxGroupCells = state.totalCells - state.knownCells;
// after
import { getEffectiveMaxCells } from './estimator.js'; // already imported at top
const effectiveMax = getEffectiveMaxCells(state) ?? state.totalCells;
const maxGroupCells = effectiveMax - state.knownCells;
```

### `buildPredictionRow` — overflow detection

```js
const isOverflow = item.state.knownCells > item.state.totalCells;
const overflowTag = isOverflow
  ? t('ethan.status.overflowCells', { total: item.state.knownCells })
  : null;

return {
  // ...existing fields...
  statusClass: isOverflow ? 'status-over' : 'status-ok',
  tags: overflowTag ? [overflowTag] : [],
};
```

### `buildCombinedPredictionRow` — same overflow detection

Same `isOverflow` check using `item.state.knownCells > item.state.totalCells`. Apply `statusClass` and `tags` identically.

### `appendPricePrediction` — merge tags

```js
const isOverflow = nextState.knownCells > state.totalCells;
row.tags = [
  t('ethan.status.priceMatchTag'),
  ...(isOverflow ? [t('ethan.status.overflowCells', { total: nextState.knownCells })] : []),
];
if (isOverflow) row.statusClass = 'status-over';
```

Both "均价匹配" and "总格数:x" tags can appear on the same row.

## i18n (`src/shared/messages.js`)

Add to `ethan.status` in both locales:

```js
// zh-CN
overflowCells: '总格数:{total}',
// en-US
overflowCells: 'Cells:{total}',
```

## CSS (`public/ethan/ethan.css`)

Add alongside existing `.status-ok`, `.status-warn`, `.status-error`:

```css
.status-over {
  color: #7b9fd4;
}
```

Blue-grey tone — distinct from green (status-ok) and non-alarming.

## Out of Scope

- No change to orange/gold overflow behavior (user did not request)
- No change to `estimateTotalByStage` pricing logic — the overflow rows still use the same unit price estimation
- No change to the `collectEstimationInputs` validation (`knownCells > totalCells` check remains, preventing direct-input overflows)
