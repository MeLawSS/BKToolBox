# Tools Hero Consolidation Design

## Goal

Consolidate the user-facing `Ethan` and `Ahmed` entry points into the existing `Tools` page so that hero-oriented tooling is reached from one place.

The resulting behavior must be:

- `Tools` becomes the canonical entry for `Elsa`, `Ethan`, and `Ahmed`
- `Tools` shows hero tabs first, in this exact order:
  - `Elsa`
  - `Ethan`
  - `Ahmed`
- old `/Ethan` and `/Ahmed` URLs continue to work by redirecting to:
  - `/Tools?tab=ethan`
  - `/Tools?tab=ahmed`
- `TopBar` and `Home` no longer expose standalone `Ethan` / `Ahmed` navigation items

## Non-Goals

- Do not redesign the monitor, price, or inject pages.
- Do not rewrite the whole `Tools` page into a router-driven SPA.
- Do not fully rewrite `Ahmed` into a new composable architecture in this pass.
- Do not remove compatibility for old `/Elsa`, `/Ethan`, or `/Ahmed` URLs.
- Do not change existing solver algorithms or `/run` protocol behavior.

## Current State

### Tools today

[`src/elsa/App.vue`](../../../src/elsa/App.vue) is already the real `Tools` page even though it lives under `src/elsa/`.

It currently contains:

- `9` solver tabs
- `1` embedded `Elsa` panel tab
- local `activeTabIndex` persistence in `localStorage`
- no URL query-driven tab selection

### Ethan today

[`src/ethan/App.vue`](../../../src/ethan/App.vue) is already a thin wrapper around the shared hero estimator:

- it mounts [`src/hero-estimator/HeroEstimatorPanel.vue`](../../../src/hero-estimator/HeroEstimatorPanel.vue)
- it passes `ethanProfile`
- it is therefore already suitable for an embedded wrapper just like `Elsa`

### Ahmed today

`Ahmed` is still a hybrid:

- [`src/ahmed/App.vue`](../../../src/ahmed/App.vue) renders the page structure
- [`public/ahmed/ahmed.js`](../../../public/ahmed/ahmed.js) owns most behavior through DOM hooks
- the page depends on stable ids/classes/data hooks rather than Vue-local state

That makes Ahmed consolidation fundamentally different from Ethan consolidation.

## Chosen Approach

Use one canonical `Tools` container with mixed tab kinds:

- `panel` tabs for `Elsa`, `Ethan`, and `Ahmed`
- existing `solver` tabs unchanged after the hero tabs

This is intentionally incremental:

- `Ethan` is embedded by reusing the current shared hero-estimator architecture
- `Ahmed` is embedded by preserving its existing DOM contract and mounting its legacy controller against an embedded panel root

## Route And Navigation Design

### Canonical entry

`/Tools` remains the canonical user-facing destination for all hero tools.

### Compatibility redirects

- `/Elsa` and `/elsa` continue redirecting to `/Tools`
- `/Ethan` and `/ethan` redirect to `/Tools?tab=ethan`
- `/Ahmed` and `/ahmed` redirect to `/Tools?tab=ahmed`

### Navigation cleanup

The shared top-level navigation is simplified:

- keep `Home`
- keep `Tools`
- remove standalone `Ahmed`
- remove standalone `Ethan`
- keep `Monitor`
- keep `Price`
- keep `Inject`

The same cleanup applies to the `Home` launcher cards.

## Tools Page Design

### Tab order

The final tab order is:

1. `Elsa`
2. `Ethan`
3. `Ahmed`
4. current solver tabs in existing order

### Tab selection sources

Tab selection priority is:

1. valid `?tab=` query in the current URL
2. saved local page state
3. default `Elsa`

### URL synchronization

When the user changes the active tab inside `Tools`, the page updates the current URL query to the canonical tab id using `history.replaceState`.

Reason:

- deep links remain stable
- browser history is not polluted with one entry per tab click

## Ethan Integration Design

Create an embedded wrapper for Ethan that mirrors the current Elsa panel pattern:

- add `src/ethan/EthanHeroPanel.vue`
- mount `HeroEstimatorPanel` with `ethanProfile`
- pass `embedded`

This avoids duplicating Ethan logic and keeps the standalone route behavior separate from the embedded usage.

## Ahmed Integration Design

### Short-term architecture

Introduce an embedded Ahmed panel instead of rewriting Ahmed state:

- create `src/ahmed/AhmedPanel.vue`
- reuse the existing Ahmed DOM structure from `src/ahmed/App.vue`
- remove only the standalone page shell concerns such as `TopBar`
- continue to drive behavior from the existing Ahmed controller

### Controller integration

`public/ahmed/ahmed.js` must stop assuming a one-time document-global page boot.

It should be reshaped into a mountable controller API that can:

- bind against an embedded panel root
- initialize the same event handlers and page-state behavior
- cleanly tear down listeners when the tab is unmounted or remounted in tests

### DOM contract

Ahmed’s DOM ids/classes/hooks must remain stable during this pass.

That preserves:

- existing controller assumptions
- existing tests
- future migration freedom without mixing this work with a full Ahmed rewrite

## Testing Design

### Tools

Add or update tests to prove:

- hero tabs render first in the required order
- `?tab=ethan` selects Ethan on first render
- `?tab=ahmed` selects Ahmed on first render
- changing tabs updates the URL query
- solver tabs still drive `/run`
- embedded hero tabs do not use `/run`

### Navigation and routes

Update tests to prove:

- topbar no longer shows standalone `Ahmed` / `Ethan`
- home launcher no longer shows standalone `Ahmed` / `Ethan`
- `/Ahmed` and `/Ethan` redirect to the correct `Tools?tab=...` URLs

### Ahmed

Add an embedded Ahmed smoke test to prove:

- the panel can mount inside `Tools`
- the controller can initialize against the embedded DOM
- the expected primary DOM hooks are present

## Risks And Mitigations

### Risk: Ahmed controller assumes global singleton page boot

Mitigation:

- move controller startup behind an explicit mount function
- add a destroy path for tests and remounts
- keep DOM ids unchanged

### Risk: Tools local state conflicts with query-driven selection

Mitigation:

- define a strict priority order: query first, then saved state
- centralize tab id/index conversion in one helper layer

### Risk: breaking existing solver behavior while reordering tabs

Mitigation:

- keep solver tab definitions unchanged
- change only the surrounding tab composition and selection logic
- add targeted Tools tests for both panel and solver modes
