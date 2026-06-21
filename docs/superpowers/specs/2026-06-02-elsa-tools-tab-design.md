# Elsa Tools Tab Design

## Goal

Add a new high-interaction `Elsa` tab inside the existing `Tools` page that matches the interaction depth of the current `Ethan` experience while using Elsa-specific hero skill support instead of Ethan-specific hero skill support.

The new tab must:

- live inside `Tools`, not as a separate route
- keep the existing `Ethan` page user-visible behavior unchanged
- use Elsa-specific hero skill semantics from [docs/BIDKING_SKILL_PARSE_SUPPORT.md](../BIDKING_SKILL_PARSE_SUPPORT.md)
- use a true six-group quality model for Elsa:
  - `white`
  - `green`
  - `blue`
  - `purple`
  - `orange`
  - `red`
- preserve `orange` and `red` groups in the Elsa tab for in-match information and manual estimation workflows

## Non-Goals

- Do not rewrite the whole `Tools` page.
- Do not change the current `Ethan` page behavior, input model, or user-visible estimation flow.
- Do not convert the `Ethan` page from `wg` to separated `white` and `green`.
- Do not add new server-side solver scripts for qualities that do not already have supported search paths.
- Do not introduce a new top-level `/Elsa` page route.

## Working Definitions

### `wg` variant

`wg` is an Ethan-only grouping choice, not a canonical BidKing quality model.

It means:

- `white` and `green` are intentionally merged into one estimation group
- monitor facts may still preserve exact quality id or quality name internally
- but Ethan-facing grouped state, autofill inputs, and estimation all consume the merged `wg` bucket

Elsa must not reuse this grouping.

### Existing behavior frozen

“Keep Ethan behavior frozen” means the Elsa work is not allowed to change Ethan’s current user-visible behavior unless a bug fix is required independently of Elsa.

For this feature, frozen specifically includes:

- route shape and page entry: `/Ethan` remains a standalone page
- Ethan group model: `wg / blue / purple / orange / red`
- current input fields, placeholder behavior, and autofill priority
- current new-game reset semantics
- current result table shape and prediction flow
- current Ethan-only hero skill handling

Internal refactoring is allowed only if Ethan remains behaviorally equivalent from the user perspective.

## Current Context

### Tools today

[`src/elsa/App.vue`](../../../src/elsa/App.vue) currently supports only solver-style tabs:

- each tab is driven by `script`, `fields`, and `getArgs`
- each tab runs through `/run`
- output is rendered as streaming text or table rows

This structure is not sufficient for a tab that needs:

- monitor start/stop controls
- live SSE monitor consumption
- 43x10 outline matrix rendering
- monitor-driven autofill behavior
- mixed estimation and result-table logic

### Ethan today

[`src/ethan/App.vue`](../../../src/ethan/App.vue) currently combines:

- monitor SSE connection
- monitor event adaptation
- local storage state persistence
- matrix rendering and outline detail modal
- manual and monitor-driven inputs
- result generation and prediction display
- price-match logic for supported groups

Its internal model is Ethan-specific:

- qualities are grouped as `wg / blue / purple / orange / red`
- `white` and `green` are merged into `wg`
- hero-specific behavior assumes Ethan rules

### Monitor facts and store today

[`lib/bidking-monitor-facts.js`](../../../lib/bidking-monitor-facts.js) and [`lib/bidking-monitor-store.js`](../../../lib/bidking-monitor-store.js) currently encode Ethan-biased group logic:

- quality ids `1` and `2` collapse into `wg`
- quality names like `普品` can collapse into `wg`
- store state is initialized with fixed group keys:
  - `wg`
  - `blue`
  - `purple`
  - `orange`
  - `red`

That is incompatible with the Elsa requirement to keep `white` and `green` separate.

### Elsa skill behavior

Per [docs/BIDKING_SKILL_PARSE_SUPPORT.md](../BIDKING_SKILL_PARSE_SUPPORT.md):

- Elsa hero skills are represented by `1001031` to `1001034`
- these skill ids identify Elsa hero packets, but group assignment should still prefer the payload quality when present
- they produce `qualityOnly` monitor events
- they reveal box positions, slot shape, and quality
- they do not include exact item identity or exact price
- for Elsa, rounds `1` to `4` reveal all outlines for:
  - `white`
  - `green`
  - `blue`
  - `purple`

This means Elsa estimation cannot simply reuse Ethan’s “guess cells first, then refine” flow for those four groups.

## Chosen Approach

Use a shared hero-estimator foundation with profile-based behavior.

This keeps the existing `Ethan` page behavior frozen while allowing a new `Elsa` tab inside `Tools` to run a different quality grouping and different skill interpretation rules.

Profile-aware facts and store are required, not optional.

Reason:

- once the facts layer collapses `white` and `green` into `wg`, the UI can no longer reconstruct Elsa’s separated model correctly
- store initialization, dedupe, and grouped autofill all depend on the active group set
- keeping profile choice below the UI prevents a fragile “shared shell plus many Elsa exceptions” design

This is intentionally not:

- a full fork of the Ethan implementation
- a global rewrite of Ethan into a six-group system
- a pile of `if (isElsa)` branches inside existing Ethan files

## Rejected Alternatives

### 1. Full Elsa fork from Ethan

Copy the current Ethan implementation into a new Elsa-specific component and patch it until it works.

Why rejected:

- duplicates a large amount of monitor, estimation, and UI logic
- future fixes would need to be applied twice
- high long-term maintenance cost

### 2. Full multi-hero rewrite first

Convert Ethan immediately into a generalized six-group framework, then build Elsa on top.

Why rejected:

- too much risk for one feature
- violates the requirement that Ethan user-visible behavior remains frozen
- would enlarge the diff far beyond the Elsa feature boundary

## Architecture

### 1. Upgrade Tools to support panel tabs

`Tools` must support two tab kinds:

- `solver`
  - current behavior
  - `fields + getArgs + /run`
- `panel`
  - renders a full Vue component in the right panel
  - does not use `/run` as its primary interaction path

The new Elsa tab will be a `panel` tab.

Current solver tabs remain unchanged.

### 2. Extract a shared hero estimator shell

Introduce a shared hero estimator layer used by:

- the existing `Ethan` page
- the new `Elsa` panel tab in `Tools`

This shell owns the common mechanics:

- monitor SSE subscription
- monitor status management
- local state persistence
- matrix rendering
- outline detail modal behavior
- form rendering
- result table rendering
- estimate refresh scheduling
- supported price-match flows

### 3. Drive hero-specific behavior through profiles

The shared shell receives a profile object.

There will be at least two profiles:

- `ethanProfile`
- `elsaProfile`

Each profile defines:

- group list
- group labels and i18n keys
- quality id to group mapping
- quality name to group mapping
- aggregate skill mapping
- hero-specific monitor interpretation rules
- which groups support price-only search
- how monitor autofills are interpreted
- how result tags and statuses are labeled

### 4. Make monitor facts and store profile-aware

The raw protocol parsing stays shared.

However, turning a raw event into monitor facts, and turning monitor facts into grouped monitor state, must accept the current profile.

This allows:

- Ethan to keep `wg`
- Elsa to keep `white` and `green` separated

without duplicating the parser.

The boundary should be:

- raw packet decoding
  - shared and profile-agnostic
- facts mapping
  - profile-aware for quality-to-group mapping and Elsa-specific complete-outline semantics
- grouped monitor state
  - profile-aware for initial group keys, aggregate value placement, and dedupe scope
- UI shell
  - consumes already-profiled state instead of re-deriving group semantics ad hoc

This boundary is deliberate. If `white` and `green` are collapsed into `wg` before facts/state are built, Elsa cannot recover that distinction later in the UI.

## File and Module Layout

### New shared UI and state modules

Add a shared directory for hero estimator logic:

- `src/hero-estimator/HeroEstimatorPanel.vue`
- `src/hero-estimator/useHeroEstimatorPanel.js`
- `src/hero-estimator/hero-profiles.js`
- `src/hero-estimator/monitor-profile-adapter.js`
- `src/hero-estimator/result-row-builder.js`

Responsibilities:

- `HeroEstimatorPanel.vue`
  - presentational shell
  - renders common form, matrix, result table, summary cards, and monitor controls
- `useHeroEstimatorPanel.js`
  - stateful behavior
  - monitor connection, storage, autofill, estimate refresh, search lifecycle
- `hero-profiles.js`
  - `ethanProfile`
  - `elsaProfile`
- `monitor-profile-adapter.js`
  - converts monitor state into profile-specific autofills and group behavior
- `result-row-builder.js`
  - shared row-building helpers for result tables and status tags

### New Elsa tab wrapper

Add a thin Elsa wrapper under `src/elsa/`:

- `src/elsa/ElsaHeroPanel.vue`
- `src/elsa/ElsaHeroPanel.test.js`

This wrapper:

- is rendered from the `Tools` page
- passes `elsaProfile` into the shared shell
- owns any Elsa-specific text or light wrapper layout

### Ethan wrapper remains a route component

[`src/ethan/App.vue`](../../../src/ethan/App.vue) becomes a thin page wrapper around the shared shell using `ethanProfile`.

This preserves:

- `/Ethan` route
- top-level navigation presence
- current Ethan behavior

### Tools container updates

Modify [`src/elsa/App.vue`](../../../src/elsa/App.vue) and [`src/elsa/App.test.js`](../../../src/elsa/App.test.js) to:

- support `solver` tabs
- support `panel` tabs
- add one new `Elsa` panel tab
- preserve the current 9 solver tabs unchanged

### Profile-aware monitor library updates

Modify:

- [`lib/bidking-monitor-facts.js`](../../../lib/bidking-monitor-facts.js)
- [`lib/bidking-monitor-store.js`](../../../lib/bidking-monitor-store.js)

to accept profile-driven group semantics instead of fixed Ethan semantics.

### Estimator parameterization

Modify:

- [`src/ethan/estimator.js`](../../../src/ethan/estimator.js)
- [`src/ethan/estimator.test.js`](../../../src/ethan/estimator.test.js)

so that pure estimation logic can consume:

- profile group definitions
- per-group default values
- profile prediction configuration

instead of assuming a single built-in Ethan grouping model.

## Elsa Data Model

### Groups

Elsa uses these six groups:

- `white`
- `green`
- `blue`
- `purple`
- `orange`
- `red`

These six groups must stay distinct across:

- facts
- grouped monitor state
- autofill interpretation
- result rows
- persisted Elsa panel state

### Group categories

#### Elsa-primary groups

- `white`
- `green`
- `blue`
- `purple`

These groups:

- receive Elsa round-based full-outline revelations
- get total cells directly from revealed outlines
- keep `priceAverage` as a fixed-total matching input
- keep separate totals, outlines, and result rows
- do not use price-only cell discovery as the main path

#### Preserved advanced groups

- `orange`
- `red`

These groups:

- stay visible in the Elsa tab
- continue to support in-match information and manual estimation
- are not part of Elsa’s four-stage complete-reveal guarantee
- use existing generic monitor information when available
- may continue to use supported search flows if the current solver paths already exist

## Monitor Interpretation Rules

### Raw Elsa hero skill interpretation

For Elsa-specific hero events:

- `heroCid` must identify Elsa
- skill ids `1001031` to `1001034` are treated as Elsa hero outline events
- quality from `hitBoxList[].itemQuility` / `itemQuilityName` is the authoritative group identity when present
- each event yields:
  - outline revelation
  - quality cell revelation
- these events do not create exact item revelations unless exact fields are present

### Round-to-group mapping

Elsa rounds map to groups as follows:

- round 1 -> `white`
- round 2 -> `green`
- round 3 -> `blue`
- round 4 -> `purple`

The tab must treat these as group-complete outline revelations.

Implementation note:

- use payload quality to determine which group a specific outline belongs to
- use the Elsa round model to decide that the affected group is now complete, not partial
- do not infer exact item identity, price, or count from round number alone

### Complete-outline semantic

When an Elsa round-specific event arrives for one of the four Elsa-primary groups:

- all outlines for that group are considered known
- that group’s total cells become derivable from outlines
- the total should be computed from the revealed outline cells, then treated as monitor truth for that group
- that group no longer depends on average-cells-driven cell discovery
- `purple` follows the same rule as `white / green / blue`; it is not a special “needs separate cell discovery” case in Elsa
- later `priceAverage` input may refine the estimate within the known total, but it must not reopen speculative total-cell search

### Deduplication

Per current protocol observations:

- the same Elsa skill may appear again under `msgId 33`, `37`, and `45`
- hit box order may vary between occurrences

Consumption must dedupe by stable event identity scoped to game, not by list order.

## Input and Autofill Rules

### Global rules

Priority order remains:

1. user-entered value
2. monitor-derived value
3. placeholder/fallback

Elsa changes what counts as monitor-derived truth for `white / green / blue / purple`. It does not change the shared field precedence rules.

### Elsa-primary groups: `white`, `green`, `blue`, `purple`

For these groups:

- `cells`
  - automatically determined from Elsa full-outline revelations
  - becomes the default monitor-derived value for estimation when the user has not entered a manual value
  - must suppress unknown-total discovery logic even when it is shown as an autofill or placeholder rather than a hard override

- `avg`
  - remains present
  - may aid interpretation or validation
  - is not the primary mechanism for discovering total cells

- `priceAverage`
  - remains present
  - when total cells are known, used for fixed-total matching and estimate refinement
  - does not trigger Ethan-style price-only streaming cell discovery
  - does not trigger speculative total-cell enumeration

- `count`
  - remains derivable or manually entered per the shared estimator flow
  - must not be back-computed by pretending the group still has unknown total cells

### Preserved groups: `orange`, `red`

For these groups:

- keep normal manual input behavior
- keep monitor autofill support from generic monitor facts and in-match revealed information
- keep currently supported estimation and matching behavior where a solver path already exists
- keep their value even when Elsa-primary groups no longer need Ethan-style discovery, because Elsa still needs mid-match information for `orange` and `red`

## Matrix and Outline Behavior

The Elsa tab keeps the Ethan-style matrix interaction model:

- 43x10 grid
- clickable outlines
- outline detail overlay
- conflict quality rendering
- monitor-driven resets on new game

But Elsa changes the meaning of some outlines:

- for `white`, `green`, `blue`, `purple`, Elsa-revealed outlines are whole-group truth, not just partial hints
- for `white` and `green`, the UI must keep qualities visually and logically distinct even though Ethan collapses them into `wg`
- for `orange`, `red`, outlines remain ordinary partial monitor evidence

The matrix should therefore support two outline confidence modes:

- complete-group outline knowledge for Elsa-primary groups
- partial evidence for generic or non-Elsa-derived outlines

## Result Table Rules

The Elsa result table should stay structurally consistent with Ethan so the product feels coherent.

Recommended result-status categories:

- `complete outlines known`
- `outline estimated`
- `average price matched`
- `generic estimated`
- `overflow`

### Elsa-primary groups

For `white`, `green`, `blue`, `purple`:

- if full Elsa outlines are known and no average price is filled:
  - use outline-derived total cells with standard estimation
- if full Elsa outlines are known and average price is filled:
  - use fixed-total average-price matching to refine the estimate
- once a group is fully revealed, its status must not fall back to an Ethan-style “guess total cells first” path
- if both outline truth and average price exist for `purple`:
  - follow the same fixed-total refinement path as `white / green / blue`
  - do not fall back to Ethan’s older purple-specific discovery assumptions

### Preserved groups

For `orange`, `red`:

- follow the shared generic estimation path
- use monitor data if available
- use supported search/matching flows if configured by the profile

## Search and Matching Rules

### White / Green / Blue / Purple

Do not use Ethan-style price-only streaming cell discovery.

Reason:

- Elsa rounds already reveal all outlines for these groups
- total cells are already known from the matrix
- the remaining value of `priceAverage` is fixed-total matching and estimate refinement
- `purple` is explicitly included in this rule

### Orange / Red

Keep them eligible for ordinary supported search or match behavior where current backend support exists.

This design intentionally does not require new backend solver scripts for unsupported groups.

## New Game Handling

Elsa tab follows Ethan’s current whole-session reset strategy:

- when a new `gameUid` is detected, all current match state is cleared
- previous outlines are removed
- monitor autofill state is cleared
- user-entered values are cleared if that is what the current shared shell behavior already does

This must remain consistent between Ethan and Elsa to avoid surprise state leakage across matches.

For Ethan, refactoring must preserve the current reset behavior exactly.

## Failure and Conflict Handling

- If monitor service is unavailable, the Elsa panel still works as a manual six-group estimator. Monitor-enhanced behavior is additive, not required for baseline use.
- If outline and quality facts conflict, keep the existing shared conflict rendering model rather than inventing Elsa-only conflict UI.
- If repeated Elsa events for the same game disagree on outline contents, dedupe by stable event identity first, then recompute the accepted outline set. Do not append duplicate outlines blindly.
- If a user-entered `cells` value disagrees with Elsa monitor-derived cells, shared precedence still shows the user value, but monitor-derived placeholder or detail text should continue to expose the known monitor total.

## Testing Strategy

### 1. Facts tests

Update and add tests around [`lib/bidking-monitor-facts.test.mjs`](../../../lib/bidking-monitor-facts.test.mjs):

- same quality event maps to `wg` in `ethanProfile`
- same quality event maps to `white` or `green` in `elsaProfile`
- Elsa `1001031-1001034` generate correct outline and quality facts
- Elsa complete-outline facts do not require exact item metadata to be present
- Elsa payload quality remains the group source even when round metadata is also present
- non-Elsa hero events do not trigger Elsa-specific complete-outline semantics

### 2. Store tests

Update and add tests around [`lib/bidking-monitor-store.test.mjs`](../../../lib/bidking-monitor-store.test.mjs):

- empty state is profile-shaped
- Ethan profile still creates 5 groups
- Elsa profile creates 6 groups
- white and green stay separate in Elsa
- Elsa complete-outline events compute total cells from outlines for `white / green / blue / purple`
- Elsa complete-reveal groups do not collapse back into `wg`
- new game reset works in both profiles

### 3. Estimator tests

Update and add tests around [`src/ethan/estimator.test.js`](../../../src/ethan/estimator.test.js):

- Ethan baseline remains unchanged
- Elsa six-group input collection works
- Elsa primary groups do not use price-only cell discovery
- Elsa fixed-total average-price refinement works for groups with outline-known total cells
- Elsa `purple` follows the same non-discovery path as `white / green / blue`

### 4. Shared panel tests

Add tests for shared hero estimator modules:

- Ethan profile renders current Ethan groups
- Elsa profile renders six groups
- Elsa full-outline monitor events autofill group cells correctly
- Elsa `white / green / blue / purple` average-price input refines existing totals instead of launching price-only discovery
- Elsa panel still supports manual estimation when monitor events never arrive
- switching between Ethan and Elsa profiles does not leak persisted group keys or stale autofills

### 5. Tools container tests

Update [`src/elsa/App.test.js`](../../../src/elsa/App.test.js):

- existing 9 solver tabs still render and behave unchanged
- new Elsa tab renders as a panel tab
- switching between solver tabs and Elsa panel tab works
- panel tab state persists without breaking existing tab state

### 6. Ethan regression tests

Keep and run:

- [`src/ethan/App.test.js`](../../../src/ethan/App.test.js)
- [`src/ethan/monitor-adapter.test.js`](../../../src/ethan/monitor-adapter.test.js)
- [`src/ethan/monitor-grid.test.js`](../../../src/ethan/monitor-grid.test.js)
- [`src/ethan/estimator.test.js`](../../../src/ethan/estimator.test.js)

The Elsa feature is not complete if Ethan behavior regresses.

Regression review checklist:

- Ethan still renders `wg`, not separate `white` and `green`
- Ethan monitor-derived autofills still target the same field ids and priority order
- Ethan new-game reset still clears the same state it clears today
- Ethan result rows and prediction tags remain stable unless a pre-existing bug is being fixed on purpose

## Implementation Order

Recommended sequence:

1. make monitor facts and store profile-aware
2. parameterize estimator and profile-dependent helpers
3. extract shared hero-estimator shell
4. reconnect Ethan to the shared shell without visible behavior changes
5. upgrade Tools to support `panel` tabs
6. mount the new Elsa panel tab inside Tools

This order minimizes debugging ambiguity.

## Verification Commands

At minimum:

- `npx vitest run lib/bidking-monitor-facts.test.mjs lib/bidking-monitor-store.test.mjs`
- `npx vitest run src/ethan/estimator.test.js src/ethan/App.test.js src/ethan/monitor-adapter.test.js src/ethan/monitor-grid.test.js`
- `npx vitest run src/elsa/App.test.js src/elsa/ElsaHeroPanel.test.js`
- `npm test`

Optional build checks when safe for the worktree:

- `npm run build:elsa`
- `npm run build:ethan`
- `npm run build:pages`

## Done When

- Tools contains a new Elsa panel tab
- Ethan page behavior remains unchanged from the user perspective
- Elsa uses six independent groups rather than `wg`
- Elsa rounds 1 to 4 populate `white / green / blue / purple` through complete outline revelations
- `orange` and `red` remain available in the Elsa tab
- `white / green / blue / purple` use average-price refinement against known totals instead of price-only cell discovery
- Elsa `purple` no longer relies on Ethan-specific purple discovery behavior
- monitor facts and store support both Ethan and Elsa semantics through profiles
- Elsa never loses `white` versus `green` identity to an early `wg` collapse
- regression tests cover both profiles and the Tools container behavior
