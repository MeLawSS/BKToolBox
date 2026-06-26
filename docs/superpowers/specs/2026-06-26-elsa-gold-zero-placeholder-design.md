# Elsa Gold Zero Placeholder Design

Note: the user-facing term "gold" (`金`) maps to the internal group key `orange` throughout this spec.

## Goal

When the Elsa expected-value page receives a realtime monitor aggregate event proving that the gold/orange group's average occupied cells is `0`, the page should automatically:

- show the gold average-cells placeholder as `0`
- show the gold total-cells placeholder as `0`

This change must remain placeholder-only. It must not overwrite explicit user input values.

## Non-Goals

- Do not read `A:\BidKing\log` files at runtime. Those files are only debugging artifacts.
- Do not add any new Elsa-specific log-scanning, polling, or bootstrap parsing flow.
- Do not write `0` into `#elsa-avg-orange` or `#elsa-cells-orange` input values automatically.
- Do not expand the rule to purple or red groups in this round.
- Do not change the monitor store contract or the hero-estimator placeholder rendering contract.

## Current Context

The repository already has a monitor fact pipeline:

1. realtime monitor events are converted into fact objects in `lib/bidking-monitor-facts.js`
2. `lib/bidking-monitor-store.js` applies those facts into per-game monitor state
3. `src/hero-estimator/useHeroEstimatorPanel.js` consumes monitor state and exposes placeholder values for the shared Elsa/Ethan estimator UI

The current system already supports:

- orange average-cells aggregate facts via `group.averageCellsKnown`
- orange total-cells aggregate facts via `group.totalCellsKnown`
- placeholder-only monitor autofill behavior
- direct zero-total facts from protocol payloads such as Ethan orange `totalHitBoxIndex = 0`
- inferred zero-total facts such as Ethan purple zero-count aggregate inference

This means the missing behavior is not UI wiring. The missing behavior is a narrow fact-level inference:

- if Elsa receives an orange average-cells aggregate fact with value `0`
- then the system should also treat orange total cells as known `0`

The closest implementation template is the existing `buildZeroCountTotalCellsFact()` helper in `lib/bidking-monitor-facts.js`: keep the inference in the fact-building layer and let downstream state/UI remain unchanged.

That helper is a precedent for layer placement, not for exact insertion shape. The purple rule lives inside `buildAggregateFact()` because it still produces at most one aggregate fact. The gold rule deliberately differs: it should keep `buildAggregateFact()` as a single-fact helper and append one extra inferred fact in `buildBidKingMonitorFacts()` after the direct orange average fact has already been produced.

## Design Summary

Implement the new rule in `lib/bidking-monitor-facts.js`, not in the monitor store and not in the Elsa page.

When an aggregate event produces a valid `group.averageCellsKnown` fact for the `orange` group and the parsed numeric value is exactly `0`, the fact builder should emit one additional fact for the same event:

- `type: 'group.totalCellsKnown'`
- `group: 'orange'`
- `value: 0`

This inference is profile-agnostic. It should apply for any monitor profile that already resolves the event into a valid orange `group.averageCellsKnown` fact, including Elsa and Ethan.

This inference is also source-agnostic. It should fire regardless of which aggregate parsing path produced the orange average-cells fact:

- known aggregate IDs such as `200015`
- name/group-based aggregate detection
- generic aggregate ID ranges that resolve to orange `group.averageCellsKnown`

All downstream layers remain unchanged. The existing monitor store and placeholder plumbing will automatically surface:

- `#elsa-avg-orange` placeholder = `0`
- `#elsa-cells-orange` placeholder = `0`

while keeping both actual input values empty unless the user types into them.

The profile scope is intentionally different from the purple zero-count rule. Purple zero-count inference is Ethan-only because its trigger is tied to a specific protocol pattern (`skillCid 203 + hitItemIndex === 0`) that is currently only trusted for Ethan. Gold zero-average inference is profile-agnostic because once a valid orange `group.averageCellsKnown` fact already exists, numeric average `0` implies total cells `0` regardless of hero.

## Alternatives Considered

### 1. Fact-layer inference

Add the rule in `lib/bidking-monitor-facts.js`.

Why this is recommended:

- it matches the current architecture, where business interpretation of monitor payloads lives in the fact builder
- it keeps the monitor store as a passive state container
- it keeps Elsa UI logic generic and reusable
- it aligns with the adjacent `buildZeroCountTotalCellsFact()` pattern, which already performs narrow fact inference in the same layer

### 2. Store-layer inference

Infer `totalCells = 0` inside `lib/bidking-monitor-store.js` when `orange.averageCells` becomes `0`.

Why this is rejected:

- it mixes payload interpretation into the state container
- it weakens the current boundary between “facts” and “state application”
- future monitor rules would start accumulating in the wrong layer

### 3. UI-layer inference

If Elsa sees the gold average placeholder become `0`, set the gold total-cells placeholder to `0` inside `useHeroEstimatorPanel.js`.

Why this is rejected:

- it hides monitor business logic in one consumer
- monitor state itself would still not know total cells are known `0`
- the same inference would be harder to test and harder to reuse

## Architecture

The runtime data source remains realtime monitor events only. The `log` directory is not part of the feature.

The architecture stays:

1. monitor event enters `buildBidKingMonitorFacts()`
2. aggregate parsing resolves an orange average-cells fact
3. `buildBidKingMonitorFacts()` keeps `buildAggregateFact()` unchanged as a single-fact helper
4. immediately after the existing `buildAggregateFact()` call path inside `buildBidKingMonitorFacts()`, if the returned fact is `group.averageCellsKnown` for `orange` with numeric value `0`, `buildBidKingMonitorFacts()` appends one extra orange total-cells fact with value `0`
5. monitor store applies both facts to state
6. shared hero-estimator placeholder logic renders both placeholders as `0`

No new endpoint, no new SSE stream, no new file read, and no Elsa-only placeholder special case is introduced.

## Data Flow

### Input

A realtime monitor aggregate event for the orange group that already maps to `group.averageCellsKnown`. The event source path is not restricted to one skill ID. It can come from any existing aggregate parser path that legitimately resolves to an orange average-cells fact, for example:

- known aggregate IDs such as `200015`
- name/group-based aggregate detection
- generic aggregate ID ranges that resolve to orange average-cells facts

One concrete example is an orange aggregate event carrying:

- orange aggregate identity
- `allHitItemAvgBoxIndex: 0`

### Fact generation

The fact builder should:

1. keep generating the existing `group.averageCellsKnown` fact for orange
2. additionally generate `group.totalCellsKnown = 0` when that average fact's numeric value is exactly `0`

This should be implemented as an additive rule. It must not remove or replace the average fact.

Implementation detail: keep `buildAggregateFact()` returning a single fact or `null`. The safer change is to add the zero-total inference in `buildBidKingMonitorFacts()` after the existing `aggregateFact` has been computed and pushed, rather than refactoring `buildAggregateFact()` to return arrays.

Concrete insertion sketch in `buildBidKingMonitorFacts()`:

```js
const aggregateFact = buildAggregateFact(event, source, resolvedProfile);
if (aggregateFact) {
  facts.push(aggregateFact);

  if (
    aggregateFact.type === 'group.averageCellsKnown' &&
    aggregateFact.group === 'orange' &&
    aggregateFact.value === 0
  ) {
    facts.push({
      type: 'group.totalCellsKnown',
      key: `${source.key}:group.totalCellsKnown:orange`,
      gameUid: event.gameUid ? String(event.gameUid) : null,
      group: 'orange',
      value: 0,
      source,
    });
  }
}
```

This makes the insertion point unambiguous:

- do not refactor `buildAggregateFact()` to return arrays
- do not add the rule in the monitor store
- do not add Elsa-only UI branching

### State application

`lib/bidking-monitor-store.js` should remain unchanged. It already knows how to apply:

- `group.averageCellsKnown` -> `groups.orange.averageCells`
- `group.totalCellsKnown` -> `groups.orange.totalCells`

### Placeholder consumption

`src/hero-estimator/useHeroEstimatorPanel.js` should also remain unchanged. Its current monitor-derived placeholder wiring should automatically display:

- `groupPlaceholders.orange.avg = '0'`
- `groupPlaceholders.orange.cells = '0'`

The actual explicit inputs stay empty.

## Error Handling And Rule Boundaries

This rule must be intentionally narrow.

### Required constraints

- only apply to the `orange` group
- only apply when a valid orange `group.averageCellsKnown` fact exists
- only apply when the parsed numeric average value is exactly `0`
- apply regardless of which aggregate source path produced that valid orange average-cells fact
- do not gate the rule to Elsa-only or Ethan-only; it should remain profile-agnostic
- do not fire when the field is missing, empty, malformed, `null`, or `undefined`
- do not fire for non-zero orange averages
- do not fire for purple or red average-cells events in this round

Purple already has a separate zero-total inference path through `buildZeroCountTotalCellsFact()`. Red does not need the new rule in this round.

### Overwrite behavior

The inferred `group.totalCellsKnown = 0` is not sticky beyond the normal fact model.

If the same game later receives a stronger explicit total-cells fact such as `group.totalCellsKnown = 6`, the existing monitor store behavior should keep working and the later fact should become the current state. No special conflict system is added here.

### Input safety

The estimator must continue to treat monitor-derived values as placeholders/fallbacks only. This feature must not auto-write:

- `#elsa-avg-orange`
- `#elsa-cells-orange`

If the user has already typed a value into either field, the explicit input still wins over the placeholder, exactly as it does today.

## Testing

Add regression coverage in two layers.

### 1. Fact-layer tests

Update `lib/bidking-monitor-facts.test.mjs` with:

- a positive case proving an orange average-cells aggregate event with `allHitItemAvgBoxIndex: 0` emits both:
  - `group.averageCellsKnown` for `orange` with value `0`
  - `group.totalCellsKnown` for `orange` with value `0`
- the first positive case can rely on the default `buildBidKingMonitorFacts()` profile parameter, so it already covers the Ethan/default path
- a separate profile-scope case should prove the same orange zero-average inference is not Ethan-only and also appears when `buildBidKingMonitorFacts()` runs under `ELSA_MONITOR_PROFILE`
- a negative case proving orange average-cells `> 0` does not emit an extra zero total-cells fact
- a negative case proving purple/red average-cells `0` does not gain the same inference in this round

### 2. UI regression test

Update `src/hero-estimator/HeroEstimatorPanel.test.js` with an Elsa monitor regression proving that after the relevant orange average-cells event arrives:

- `#elsa-avg-orange` has placeholder `0`
- `#elsa-cells-orange` has placeholder `0`
- both inputs still have empty string values

## Documentation Update

Update `docs/Documentation.md` to record the new current-state behavior:

- when monitor facts resolve orange average cells to `0`, `lib/bidking-monitor-facts.js` also emits `group.totalCellsKnown = 0`
- Elsa therefore shows both gold average-cells and gold total-cells placeholders as `0`
- the behavior remains placeholder-only and does not overwrite explicit input values

## Verification

At implementation time, targeted verification should include:

```powershell
npx vitest run lib/bidking-monitor-facts.test.mjs src/hero-estimator/HeroEstimatorPanel.test.js
git diff --check
```

Broader repo verification is also required:

```powershell
npm test
npm run build:pages
```

`package.json` does not currently define dedicated `lint` or `typecheck` scripts, so the required broader verification for this repo is `npm test` plus `npm run build:pages` rather than nonexistent lint/typecheck commands.

## Acceptance Criteria

The work is complete when all of the following are true:

- Elsa runtime behavior does not read `A:\BidKing\log`
- an orange average-cells aggregate event with value `0` causes Elsa to show gold average placeholder `0`
- the same event also causes Elsa to show gold total-cells placeholder `0`
- neither field's explicit value is auto-written
- the new fact-level regression tests pass
- the new Elsa placeholder regression test passes
- `docs/Documentation.md` records the new orange zero-average -> zero-total placeholder behavior
- `git diff --check`, `npm test`, and `npm run build:pages` pass during implementation verification
