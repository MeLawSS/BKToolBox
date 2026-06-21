# BidKing Monitor Facts Design

## Goal

Reduce coupling between BidKing network parsing and UI pages. Future pages such as Ethan and Ahmed should consume stable match facts, estimation inputs, and match state instead of parsing raw skill IDs and protocol fields in page components.

The application is packaged as an Electron app. The monitor has system-level responsibilities such as packet capture, parsing, de-duplication, reconnect recovery, and local logging. These responsibilities should remain outside individual renderer pages.

## Non-Goals

- Do not remove raw protocol events. They are still needed for debugging, replay, and future reverse engineering.
- Do not move UI-specific form behavior into the parser.
- Do not make every page implement its own raw event interpretation.
- Do not change capture mechanics as part of this design.

## Recommended Architecture

Use a shared facts engine plus a canonical monitor store owned by the Electron main process or local Node monitor service.

```text
TCP / pcap
  -> raw parser event
  -> shared facts engine
  -> canonical monitor state
  -> SSE / Electron bridge
  -> page adapters
  -> Ethan / Ahmed / Monitor UI
```

The parser remains raw and lossless. The facts engine converts raw events into stable domain facts. The monitor store applies facts to a single current match state. UI pages subscribe to facts and state snapshots, then use small page adapters to map them into page-specific inputs.

## Module Boundaries

### Parser

`scripts/parse-bidking-tcp-pcap.mjs` should continue to output raw events shaped around protocol data:

- `gameUid`
- `round`
- `group`
- `skill`
- protocol field names such as `hitBoxList`, `totalHitBoxIndex`, `allHitItemAvgBoxIndex`, and `allHitItemAvgPrice`

The parser should not know about Ethan fields, Ahmed constraints, or UI estimation behavior.

### Facts Engine

Add a shared pure module, for example `src/shared/bidking-monitor-facts.js`.

Responsibilities:

- Convert one raw monitor event into zero or more domain facts.
- Own hard-coded skill ID and item ID mappings.
- Own mapping from skill names and protocol payloads to quality groups.
- Preserve source metadata so each fact can be traced back to the raw event.

Example fact types:

```js
{ type: 'game.changed', gameUid, round, source }
{ type: 'item.outlineRevealed', gameUid, cells, width, height, quality, itemCid, itemName, itemPrice, source }
{ type: 'item.qualityCellsRevealed', gameUid, cells, quality, source }
{ type: 'item.exactRevealed', gameUid, cells, itemCid, itemName, itemPrice, quality, source }
{ type: 'type.revealed', gameUid, itemTypes, source }
{ type: 'group.totalCellsKnown', gameUid, group, value, source }
{ type: 'group.averageCellsKnown', gameUid, group, value, source }
{ type: 'group.averagePriceKnown', gameUid, group, value, source }
```

Quality group keys should be stable and UI-neutral:

- `wg`
- `blue`
- `purple`
- `orange`
- `red`

### Monitor Store

Add a shared reducer-style module, for example `src/shared/bidking-monitor-store.js`.

Responsibilities:

- Maintain canonical monitor state for the current match.
- Reset on confirmed new `gameUid`.
- De-duplicate facts by stable source keys.
- Merge outline and quality facts in either order.
- Maintain group aggregate fields.
- Maintain revealed item types.
- Maintain exact item facts.
- Compute derived monitor state such as minimum occupied cells.

Example state shape:

```js
{
  gameUid: '2301:1178745685059091',
  round: 3,
  groups: {
    wg: { totalCells: 36, averageCells: null, averagePrice: null },
    blue: { totalCells: 29, averageCells: null, averagePrice: null },
    purple: { totalCells: 12, averageCells: 2.8, averagePrice: null },
    orange: { totalCells: null, averageCells: null, averagePrice: 30472 },
    red: { totalCells: null, averageCells: null, averagePrice: null }
  },
  outlines: [],
  exactItems: [],
  qualityCells: [],
  revealedTypes: [],
  minimumOccupied: null,
  warnings: []
}
```

### Monitor Service

`lib/bidking-live-monitor.js` should call the shared facts engine after raw event parsing. It should maintain the canonical monitor store and expose:

- raw event for debugging
- emitted facts for incremental UI updates
- current state snapshot for initial page load and reconnect
- local log output containing raw events, facts, and state changes

This keeps Electron renderer pages light and gives all pages the same event interpretation.

### Transport

The existing SSE endpoint can continue to exist. Its event payload should evolve to include normalized data while preserving raw data:

```js
{
  rawEvent,
  facts,
  state
}
```

The Monitor page can show raw events and facts. Ethan and Ahmed should consume only `facts` and `state` through page adapters.

### Page Adapters

Each page should have a small adapter that maps canonical monitor state to page-specific behavior.

Ethan adapter examples:

- `state.minimumOccupied` becomes the placeholder/effective value for all-item total cells.
- `state.groups.blue.totalCells` becomes the blue total cells auto-fill value.
- `state.groups.purple.averageCells` becomes the purple average cells auto-fill value.
- outline and exact item values feed Ethan's value estimation logic.

Ahmed adapter examples:

- exact item facts can auto-fill exact collectible constraints.
- outline and quality facts can narrow candidates.
- aggregate group facts can provide total value or expected value inputs.

Adapters may enforce page-specific overwrite rules, such as not replacing user-entered values unless the previous value came from monitor auto-fill.

## Data Ownership Rules

- Raw protocol fields belong to the parser and facts engine only.
- Skill ID mappings belong to the facts engine only.
- Cross-page match state belongs to the monitor store only.
- Page components own UI display, user override behavior, and page-specific estimation triggers.
- Page components should not directly inspect raw `skillCid`, `itemCid`, `hitBoxList`, `totalHitBoxIndex`, `allHitItemAvgBoxIndex`, or `allHitItemAvgPrice`.

## Migration Plan

1. Extract current Ethan raw event interpretation into `bidking-monitor-facts.js`.
2. Move monitor-grid state merging into `bidking-monitor-store.js` or make it consume facts instead of raw events.
3. Add tests for raw event to facts conversion using representative skill events.
4. Add tests for store reduction across event order variations:
   - outline before quality
   - quality before outline
   - aggregate-only first event in a new match
   - exact item plus outline overlap
5. Update `lib/bidking-live-monitor.js` to emit raw event plus facts plus state.
6. Update Ethan to use a page adapter over state/facts.
7. Update Monitor to display facts/state while retaining raw event debug view.
8. Add Ahmed adapter when Ahmed auto-fill work begins.

## Testing Strategy

- Unit-test facts conversion with raw event fixtures.
- Unit-test monitor store reducers as pure functions.
- Unit-test Ethan and Ahmed adapters separately from Vue components.
- Keep Vue component tests focused on UI behavior and user overwrite rules.
- Keep parser tests focused on protocol extraction, not UI behavior.

## Compatibility

During migration, the SSE payload can temporarily include both the old raw event shape and the new `{ rawEvent, facts, state }` shape. Existing pages can continue reading raw events until their adapters are migrated.

After migration, raw events should remain available for Monitor debugging and local logs, but ordinary business pages should consume facts/state only.

## Acceptance Criteria

- Ethan has no direct hard-coded skill ID mapping in `App.vue`.
- Ahmed can be added without duplicating raw skill ID and protocol field interpretation.
- New skill support is added by changing the facts engine and tests, not multiple page components.
- A page reload or page switch receives the same canonical monitor state.
- Raw event logs remain available for reverse engineering and debugging.
