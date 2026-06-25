# Tools V2 Minimum Cells Debugger Design

## Goal

Add a new debug-focused tab under the existing `Tools` page for testing the V2 minimum total cells algorithm.

The tab must let the user:

- work on the existing `Tools` route instead of a new page
- draw collectible outlines directly on a fixed `43 x 10` matrix
- derive `boxId`, `width`, and `height` from matrix placement instead of manual text entry
- run the current V2 algorithm against the matrix state
- inspect both the headline result and the full debug payload
- persist each completed calculation locally so cases can be replayed later

## Non-Goals

- Do not add a new backend endpoint or `/run` script for this feature.
- Do not add manual `boxId` editing in this round.
- Do not change the current Ethan monitor flow or live monitor SSE behavior.
- Do not replace the existing solver tabs under `Tools`.
- Do not auto-save unfinished draft matrices before a calculation is run.

## Current Context

### Tools page today

[`src/elsa/App.vue`](../../../src/elsa/App.vue) already supports mixed tab behavior:

- `panel` tabs for embedded Vue panels such as Elsa, Ethan, and Ahmed
- `solver` tabs for `/run`-driven combination calculators

This new debugger should be implemented as a `panel` tab, not a `solver` tab, because its main interaction is matrix editing rather than script execution.

### Existing V2 algorithm

The current frontend-facing export already exists in [`src/ethan/monitor-grid.js`](../../../src/ethan/monitor-grid.js):

- `MONITOR_GRID_ROWS`
- `MONITOR_GRID_COLUMNS`
- `inferMinimumOccupiedCellsV2`

Those values are bridged from [`lib/bidking-monitor-grid.js`](../../../lib/bidking-monitor-grid.js), so the debugger can reuse the same constants and algorithm entry point as production monitor-related code.

### Existing persistence pattern

The `Tools` page already persists page-level state separately from leave-Tools cache clearing. The new debugger should follow that split explicitly:

- keep current `Tools` tab selection persistence unchanged
- keep durable debugger history separate from `TOOLS_PAGE_CACHE_KEYS`
- do not blur durable replay history with transient panel draft state

## Chosen Approach

Add one new standalone `panel` tab inside `Tools` and keep all debugger-specific state isolated from Ethan monitor state.

The panel will:

- render a fixed `43 x 10` matrix
- let the user drag a rectangular selection to create one outline
- treat the dragged rectangle's top-left cell as the outline `boxId`
- compute `width` and `height` from the dragged rectangle
- convert all current outlines into the algorithm input shape
- call `inferMinimumOccupiedCellsV2(...)` directly in the browser
- persist each completed run into local storage with enough data to replay the exact current V2 payload

This intentionally reuses only:

- grid dimensions
- row-major box numbering rules
- the V2 inference function

It intentionally does **not** reuse Ethan's full monitor state machine, because that would couple a manual debug workbench to live monitor semantics that the user does not need here.

## Architecture

### 1. Tools container integration

Update [`src/elsa/App.vue`](../../../src/elsa/App.vue) to add one more `panel` tab, for example:

- `tabId: 'min-cells-debugger'`
- `titleKey: 'tools.tabs.minCellsDebugger'`
- `component: ToolsMinimumCellsDebuggerPanel`

This keeps the tab inside the current `Tools` panel switcher rather than introducing a new route.

### 2. Panel/UI component

Add a new UI component:

- `src/elsa/ToolsMinimumCellsDebuggerPanel.vue`

Responsibilities:

- render the matrix
- render current outline list
- render action buttons
- render result cards and raw debug sections
- render local history and replay actions

The component should stay mostly presentational and delegate stateful logic to a dedicated module.

### 3. Stateful logic module

Add a dedicated state module, for example:

- `src/elsa/useMinimumCellsDebugger.js`

Responsibilities:

- hold the current outline set
- hold drag-selection draft state
- convert matrix selections to outline objects
- detect overlap/conflicts
- run `inferMinimumOccupiedCellsV2`
- build persisted history entries
- load/save local history
- restore a prior case back into the current matrix

### 4. Optional pure helper module

If the logic file starts to grow, extract pure helpers such as:

- `src/elsa/minimum-cells-debugger.js`

Responsibilities:

- row/column to `boxId` conversion
- selection normalization
- rectangle-to-outline conversion
- occupied-cell expansion
- conflict detection
- persisted entry summary generation

This keeps interaction code separate from pure transformations and makes tests cheaper to write and maintain.

## Data Model

### Grid rules

The panel uses the same board shape as monitor grid logic:

- `rows = 43`
- `columns = 10`
- `430` total cells

`boxId` uses row-major order:

- top-left cell is `1`
- right neighbor increments by `1`
- next row continues numbering

### Current outline shape

Each manually added collectible outline should be stored in a simple normalized form:

```js
{
  id: string,
  boxId: number,
  width: number,
  height: number,
  cells: number[],
}
```

`cells` is not just UI metadata in the current codebase.

Today, `inferMinimumOccupiedCellsV2(...)` still relies on `outline.cells` in fallback and debug-related paths inherited from the shared monitor-grid module, including:

- `buildFallbackMinimum(...)`
- `countKnownOutlineCells(...)`
- `withDefaultPrefixOccupiedCells(...)`

So in this round the debugger must treat `cells` as part of the effective algorithm payload, not as discardable presentation-only data. The matrix editor may derive `cells` from `{ boxId, width, height }`, but the actual object passed into the current V2 implementation must preserve `cells`.

### Persisted history entry shape

Each completed calculation should persist an entry shaped like:

```js
{
  id: string,
  createdAt: string,
  version: 1,
  grid: { rows: 43, columns: 10 },
  outlines: [
    { boxId: 12, width: 2, height: 3, cells: [12, 13, 22, 23, 32, 33] },
  ],
  result: {
    valid: true,
    minTotalCells: 19,
    knownOutlineCellCount: 14,
    unknownBlockingCellCount: 5,
    unknownBlockingCells: [2, 3, 11, 21, 22],
    order: [12],
    holeCells: [],
  },
  summary: "1 items / 14 known cells / min 19"
}
```

Requirements:

- persist the exact outline payload used by the current algorithm call, including `cells`
- persist the complete returned result object, including auxiliary debug arrays
- include a human-readable summary for quick scanning

## Interaction Model

### 1. Matrix editing

The matrix is the source of truth for outline creation.

User flow:

1. pointer down on an empty cell
2. drag across a rectangle
3. pointer up to finalize the rectangle
4. system creates one outline from that rectangle

Rules:

- the rectangle is normalized so dragging in any direction still produces the same top-left origin
- the rectangle's top-left cell becomes `boxId`
- rectangle width and height determine the outline dimensions
- outlines are always axis-aligned rectangles in this round

### 2. Outline management

The panel should support:

- selecting an existing outline from the matrix or side list
- deleting the selected outline
- clearing the current matrix

The side list should show at least:

- `boxId`
- `width x height`
- occupied cell count

### 3. Conflict handling during editing

If a drag selection overlaps any existing outline:

- do not commit the new outline
- keep the current matrix unchanged
- show an explicit conflict message

The debugger should prefer preserving a clean current case over trying to auto-merge or auto-split overlapping rectangles.

### 4. Calculation flow

When the user clicks `Calculate`:

- validate that there is at least one outline
- transform the current UI state into algorithm input:
  - `columns = 10`
  - `outlines = [{ boxId, width, height, cells }, ...]`
- call `inferMinimumOccupiedCellsV2(...)`
- show the result immediately
- persist one history entry for that completed run

Implementation note:

- UI-only fields such as `id` may be stripped before calling the algorithm
- derived `cells` must be retained in the payload passed to `inferMinimumOccupiedCellsV2(...)`

If there are no outlines:

- do not call the algorithm
- show a validation message
- do not create a history entry

## Result Presentation

The result area should have two layers.

### Summary layer

Always show:

- `valid`
- `minTotalCells`
- `knownOutlineCellCount`
- `unknownBlockingCellCount`

This lets the user judge the case quickly without opening the raw payload.

### Detail layer

Also show:

- `order`
- `unknownBlockingCells`
- `holeCells`
- the exact outline payload used for the run, including `cells`
- whether the result was `null`

The detail layer may be rendered as compact JSON blocks or structured lists. The important part is that the full V2 output remains visible without opening devtools.

## Persistence Strategy

Use a dedicated durable history key, for example:

- `bidking-tools-min-cells-debugger-history:v1`

Persisted state should contain:

- `history`

This key is for replay history only.

It must:

- survive `bidking:leave-tools`
- not be added to `TOOLS_PAGE_CACHE_KEYS`
- remain available after navigating away from `Tools` so “replay later” still works

This round should **not** persist transient panel draft state such as:

- current unsaved matrix
- selected outline
- current conflict/validation banner
- currently displayed result that has not been intentionally saved as history

Those values should reset with the ordinary page lifecycle instead of leaking across the existing leave-Tools cache boundary.

If a later round adds transient debugger cache, that cache must use a separate key and be cleared alongside the other leave-Tools page caches.

History behavior:

- append one new entry after each completed calculation
- newest entry first in the visible list
- cap stored history at a fixed limit, recommended `100` entries
- prune oldest entries when the cap is exceeded

Rationale:

- avoids unbounded local storage growth
- still leaves enough room for repeated algorithm debugging sessions

### Replay behavior

Each history entry should support:

- `Restore`
  - replaces the current matrix with the saved outlines
  - repaints the matrix without running the algorithm yet
- `Recalculate`
  - restores the saved outlines
  - immediately reruns the V2 algorithm

This gives the user both a safe inspection path and a one-click rerun path.

## Localization

All new user-facing debugger strings must be added to the locale tables in [`src/shared/messages.js`](../../../src/shared/messages.js) for both:

- `zh-CN`
- `en-US`

This includes at minimum:

- the new tab label such as `tools.tabs.minCellsDebugger`
- panel heading/subtitle copy
- action buttons like calculate, clear, delete, restore, recalculate
- validation and conflict messages
- result field labels
- history section labels and empty states

Implementation is not complete if any debugger label falls back to the raw i18n key. The current `t(...)` helper falls back to the key string when a message is missing, so locale-table updates are part of the required feature scope, not optional polish.

## Error Handling

- Empty matrix: show a validation message and do not run the algorithm.
- Overlapping drag selection: reject the new outline and keep the current matrix unchanged.
- Local storage read failure: start with empty history and keep the panel usable.
- Local storage write failure: still show the current result, but surface that history was not saved.
- `inferMinimumOccupiedCellsV2(...) === null`: render and persist `null` explicitly as a real outcome.
- Valid/fallback result objects: render and persist the returned payload as-is without frontend reinterpretation.

## Testing Strategy

### 1. Pure logic tests

Add focused tests for the debugger state/helpers, covering:

- row/column to `boxId` mapping
- reverse drag normalization
- rectangle-to-outline conversion
- occupied-cell expansion
- overlap detection
- history serialization/deserialization
- restore and recalculate behavior
- history pruning at the configured cap

### 2. Tools panel integration tests

Update [`src/elsa/App.test.js`](../../../src/elsa/App.test.js) to cover:

- the new debugger tab appears in the `Tools` tab list
- switching to the debugger tab renders the matrix panel instead of `/run` controls
- creating a case and running calculation shows the V2 result
- completed calculations are written to local storage
- a saved history entry can be restored into the matrix
- the persisted history key survives the existing `bidking:leave-tools` cache clearing path
- debugger labels render translated text instead of raw message keys

### 3. Algorithm contract tests

Do not duplicate V2 algorithm correctness tests inside the panel suite. Existing algorithm-specific tests stay in [`src/ethan/monitor-grid.test.js`](../../../src/ethan/monitor-grid.test.js).

The debugger-specific tests should only verify:

- the panel passes the expected `outlines` and `columns`
- the returned payload is displayed and persisted correctly

## Verification Commands

Implementation-phase verification should at minimum include:

- `npx vitest run src/elsa/App.test.js`
- `npx vitest run src/ethan/monitor-grid.test.js`
- `npm test`

If the panel adds dedicated helper tests, include them explicitly in the verification set as well.

## Baseline Validation Note

At spec-writing time, the fresh worktree baseline already contains unrelated failing tests under `npm test`, including failures in:

- `server.test.mjs`
- `scripts/extract-bidking-collectibles.test.mjs`
- `scripts/watch-bidking-game-log.test.mjs`
- `src/ethan/App.test.js`
- `src/inject/controllerUiNodeLabels.test.js`

Those failures are pre-existing for this worktree baseline and are not caused by this design document. Implementation work should avoid broadening that failure set.

## Done When

- `Tools` contains a new dedicated V2 minimum-cells debugger tab.
- The tab renders a fixed `43 x 10` matrix that follows current monitor grid numbering rules.
- Users can add outlines through drag selection without typing `boxId`.
- The current matrix converts into algorithm input and runs through `inferMinimumOccupiedCellsV2`.
- The UI shows both summary fields and full debug output fields from the V2 result.
- Each completed calculation is persisted locally with outlines, result payload, timestamp, and summary.
- The persisted outline payload matches the current V2 algorithm contract, including `cells`.
- The page shows calculation history and supports restoring or rerunning a saved case.
- Durable debugger history survives leaving `Tools`, while transient draft state does not persist across the leave-Tools reset boundary.
- All new debugger-facing strings exist in both locale tables and no raw i18n keys are visible in the UI.
- Existing Elsa, Ethan, Ahmed, and solver tabs remain behaviorally unchanged.
