# Purple Zero-Count Placeholder Design

## Goal

When the live monitor detects that the current round has `0` purple items, the Ethan hero-estimator panel should show the purple total-cells placeholder as `0`.

This round only changes the monitor-derived placeholder behavior. It does not add a new visible "purple count" field and does not implement general-purpose count inference for non-zero values.

## Non-Goals

- Do not add a new persisted `count` field to monitor state in this round.
- Do not change explicit user input behavior for `#cells-purple`; only the placeholder should become `0`.
- Do not broaden the rule to orange, red, or other groups unless current protocol evidence already maps them through existing logic.
- Do not add a generic OCR text parser for `x件`; the target sample is already coming through the realtime protocol event stream.
- Do not change solver scripts such as [`solve-purple-grid.js`](../../../solve-purple-grid.js) or [`solve-purple-combo.js`](../../../solve-purple-combo.js).

## Current Context

### Existing monitor fact pipeline

The monitor flow already normalizes protocol events through:

1. [`lib/bidking-monitor-facts.js`](../../../lib/bidking-monitor-facts.js)
2. [`lib/bidking-monitor-store.js`](../../../lib/bidking-monitor-store.js)
3. [`src/hero-estimator/useHeroEstimatorPanel.js`](../../../src/hero-estimator/useHeroEstimatorPanel.js)

The hero-estimator placeholder for purple total cells is therefore driven by monitor-derived `group.totalCellsKnown` facts rather than by ad hoc UI logic.

### Existing aggregate support

[`lib/bidking-monitor-facts.js`](../../../lib/bidking-monitor-facts.js) already converts several purple aggregate packets into:

- `group.totalCellsKnown`
- `group.averageCellsKnown`
- `group.averagePriceKnown`

It also already supports direct zero totals when a packet includes `totalHitBoxIndex: 0`.

### Current gap

The missing case is a protocol aggregate event that communicates the purple item count through `hitItemIndex === 0` but does not carry `totalHitBoxIndex`.

In that situation:

- the event reaches the parser
- the event can still be associated to the `purple` group
- no `group.totalCellsKnown` fact is emitted today
- the purple total-cells placeholder therefore stays empty instead of showing `0`

## Chosen Approach

Add a narrow fact-layer inference in [`lib/bidking-monitor-facts.js`](../../../lib/bidking-monitor-facts.js):

- if a skill resolves to the `purple` group
- and `hitItemIndex === 0`
- and the event does not already produce a stronger `group.totalCellsKnown` fact from `totalHitBoxIndex`

then emit:

```js
{
  type: 'group.totalCellsKnown',
  group: 'purple',
  value: 0,
}
```

This keeps the behavior inside the existing domain pipeline and lets the current placeholder wiring work without UI-specific branching.

## Why This Approach

This is the smallest change that matches the confirmed requirement:

- the user only wants placeholder `0`
- only for the `purple` group
- only when the detected item count is `0`

Adding a new `group.countKnown` fact type would be a broader design for future work, but it would introduce new state shape, store handling, and UI interpretation that the current requirement does not need.

Patching the UI directly would be weaker because it would bypass the existing monitor fact model and make future protocol reasoning harder to maintain.

## Architecture

### 1. Fact generation

Update [`buildAggregateFact(...)`](../../../lib/bidking-monitor-facts.js) so it can fall back to a zero-total inference after the existing direct aggregate checks.

Required rule ordering:

1. keep current known aggregate handling unchanged
2. keep current `totalHitBoxIndex` handling unchanged
3. only if no total-cells fact was emitted yet, check for the purple-zero-count condition

This preserves current behavior for stronger packets and only fills the current gap.

### 2. Store behavior

[`lib/bidking-monitor-store.js`](../../../lib/bidking-monitor-store.js) already accepts `group.totalCellsKnown` and writes it into `state.groups[group].totalCells`.

No store schema change is needed.

### 3. Hero-estimator placeholder behavior

[`src/hero-estimator/useHeroEstimatorPanel.js`](../../../src/hero-estimator/useHeroEstimatorPanel.js) already derives placeholders from monitor state. Once purple `totalCells` becomes `0` in monitor state, the panel should render the placeholder as `0` without any panel-specific feature logic.

## Matching Rule

The new inference must only fire when all of the following are true:

- the event has a `skill`
- the aggregate group resolves to `purple`
- `hitItemIndex` is present and numerically equals `0`
- `totalHitBoxIndex` is `undefined`, `null`, or empty

It must not fire when:

- the group resolves to any non-purple group
- `hitItemIndex` is non-zero
- `totalHitBoxIndex` is already present
- the event cannot be mapped to a single aggregate group

## Data Contract

No new public state fields are introduced.

The emitted fact remains the existing shape:

```js
{
  type: 'group.totalCellsKnown',
  key: '<source-key>:group.totalCellsKnown:purple',
  gameUid: '<game-uid>',
  group: 'purple',
  value: 0,
  source: { ... }
}
```

## Testing Strategy

Follow TDD.

### 1. Fact-layer tests

Extend [`lib/bidking-monitor-facts.test.mjs`](../../../lib/bidking-monitor-facts.test.mjs) with a failing test first:

- a purple aggregate event with `hitItemIndex: 0`
- no `totalHitBoxIndex`
- expected emitted fact: `group.totalCellsKnown` for `purple` with value `0`

Also add a guard test showing the inference does not fire for a non-zero count.

### 2. UI integration test

Extend [`src/hero-estimator/HeroEstimatorPanel.test.js`](../../../src/hero-estimator/HeroEstimatorPanel.test.js) with a monitor-event scenario proving:

- the monitor event flows through the current pipeline
- `#cells-purple` keeps an empty input value
- `#cells-purple` placeholder becomes `0`

This ensures the requirement is verified at the actual visible surface, not only in a low-level fact test.

## Verification Commands

Implementation-phase verification should at minimum include:

- `npx vitest run lib/bidking-monitor-facts.test.mjs`
- `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js`
- `git diff --check`

If the touched test surface requires it, a broader `npm test` run may be added after the targeted checks.

## Risks And Boundaries

### Risk: wrong protocol interpretation for future count packets

Mitigation:

- keep the rule narrow to `purple + hitItemIndex === 0`
- do not generalize to all counts or all groups in this round
- cover the exact inferred behavior with tests

### Risk: overriding stronger totals

Mitigation:

- only apply the inference when `totalHitBoxIndex` is absent
- keep existing direct total-cells aggregate precedence unchanged

## Done When

- purple zero-count aggregate packets emit `group.totalCellsKnown = 0`
- existing non-zero or direct-total aggregate handling remains unchanged
- the Ethan hero-estimator purple total-cells input shows placeholder `0` for that case
- the input value itself remains empty until the user enters an explicit value
- targeted fact and panel tests cover the behavior
