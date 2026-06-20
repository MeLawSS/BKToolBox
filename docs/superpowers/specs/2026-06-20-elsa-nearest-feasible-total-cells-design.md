# Elsa Nearest Feasible Total Cells Design

## Goal

When the Elsa expected-value page auto-derives `totalCells` from monitor outline data and the derived value does not exactly match any feasible total implied by the current average-cells input, use the nearest feasible total instead of leaving estimation stuck at `0`.

Examples:

- average `2.5`, inferred total cells `48` -> use `50`
- average `2`, inferred total cells `19` -> `18` and `20` are equally close, so use `18`

## Scope

This round only changes **auto-derived** all-item total cells on the hero estimator page:

- applies when `globalInputs.totalCells` is empty
- applies when the page is using a monitor-derived or placeholder-derived total-cells value
- must affect both:
  - the visible `totalCells` placeholder
  - the effective total-cells value used for estimation

This round does **not** change manual input semantics:

- if the user explicitly enters `totalCells`, keep the current strict behavior
- if a manual `totalCells` conflicts with `totalAverage`, keep rejecting it
- if `totalAverage` is present and the UI switches to the exact-match select, the user can still choose only feasible totals from that list

## Current Facts

Current shared estimator behavior is split:

1. `src/ethan/estimator.js`
   - `deriveNearestCellsFromAverage(avg, preferredCells)` already exists
   - it already prefers the smaller total on equal distance
   - group-level `avg + cells` normalization already uses this helper

2. `src/hero-estimator/useHeroEstimatorPanel.js`
   - `monitorEstimatedTotalCells` currently exposes the raw outline-derived `minTotalCells`
   - `totalCellsPlaceholder` displays that raw value directly
   - `getEffectiveGlobalInputs()` also uses that raw value when the user did not manually enter total cells
   - `refreshTotalCellOptions()` still generates only exact feasible totals from the average

Because of that split, the page can show or internally consume an auto-derived total-cells value that is incompatible with the current average-cells value, even though the shared estimator already has a nearest-feasible normalization primitive.

## Chosen Approach

Reuse the existing nearest-feasible normalization logic instead of inventing a second algorithm.

Add one shared normalization entry point for **auto-derived all-item total cells**:

- input:
  - current all-item average-cells value
  - auto-derived preferred total-cells value
- output:
  - exact feasible total if the preferred value is already feasible
  - otherwise the nearest feasible total
  - if two feasible totals are equally close, choose the smaller one

The normalization must only run for **non-manual** total-cells sources.

## Behavior Rules

### 1. Manual total cells

If `globalInputs.totalCells` is non-empty:

- do not normalize it
- keep existing strict validation
- keep existing select-based exact-match behavior when `totalAverage` is present

### 2. Auto-derived total cells without average

If no all-item average is available:

- keep showing and using the raw inferred total-cells value
- no nearest-feasible adjustment is possible or required

### 3. Auto-derived total cells with average

If:

- `globalInputs.totalCells` is empty
- an auto-derived total-cells source exists
- an all-item average-cells value exists

Then:

- resolve the auto-derived total to the nearest feasible total implied by that average
- use the normalized value as the placeholder shown in the total-cells field
- use the same normalized value as the effective total-cells input for estimation

This prevents the UI from showing one value while the estimator silently uses another.

### 4. Tie-break

When two feasible totals are equally close to the inferred total:

- choose the smaller total

This rule must remain explicit and test-covered.

## Implementation Shape

### Shared estimator layer

Touch `src/ethan/estimator.js`.

Recommended implementation:

- keep `deriveNearestCellsFromAverage()` as the underlying numeric rule
- add `resolveAutoTotalCellsFromAverage(avg, preferredCells)` as the explicit shared entry point for non-manual all-item total-cells normalization

That helper should remain pure and reusable by any hero-estimator page that later wants the same behavior.

### Hero estimator page

Touch `src/hero-estimator/useHeroEstimatorPanel.js`.

Apply the new shared helper to the non-manual all-item total-cells flow:

- normalize the monitor/placeholder total before assigning `totalCellsPlaceholder`
- normalize the same value before `getEffectiveGlobalInputs()` feeds estimation

Do not mutate `globalInputs.totalCells` itself for this feature.

The field should still behave like a placeholder-backed autofill source, not like an implicit user edit.

## Testing Requirements

### Shared estimator tests

Add or extend `src/ethan/estimator.test.js` to cover:

- `2.5 + 48 -> 50`
- `2 + 19 -> 18`
- already-feasible value remains unchanged
- no average returns the original preferred total

### Hero estimator page tests

Add or extend `src/hero-estimator/HeroEstimatorPanel.test.js` to cover:

- when monitor-derived `minTotalCells` is not feasible for the current average, the total-cells placeholder shows the normalized feasible value
- when the user leaves total cells empty, estimation uses that normalized feasible value rather than the raw inferred value
- manual total-cells input behavior remains unchanged

## Non-Goals

- changing group-level manual validation rules
- changing the exact-match total-cells select options
- changing monitor outline inference itself
- introducing a new UI warning or badge for “normalized from inferred value” in this round

## Acceptance Criteria

1. On the Elsa expected-value page, an auto-derived all-item total-cells value no longer causes estimate `0` solely because it is not an exact feasible total for the current average.
2. Placeholder display and estimation input use the same normalized total-cells value.
3. Ties resolve downward.
4. Manual total-cells input remains strict and unchanged.
