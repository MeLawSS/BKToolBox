# Agent Collection Price Scheduler Design

## Goal

Move the periodic collection-price scan from the old `BKPayload64` injection path
to the AutoOperation Agent, while moving orchestration, pacing, history writes,
and UI state into BKToolBox.

## Non-Goals

- Do not keep the topbar schedule switch.
- Do not let the Agent own the hourly timer.
- Do not make the Agent write `BKPriceHistory` files for this workflow.
- Do not require `BKPayload64` for the new collection-price scan path.
- Do not remove the old DLL in the first implementation pass; keep it available
  as a temporary fallback until the Agent path is verified.

## UX

Remove the global topbar injection schedule switch.

Add an Inject page panel for collection price scanning. The panel contains:

- Start and stop controls.
- Full-scan interval, in minutes.
- Per-item base wait, in seconds.
- Per-item random wait range, in seconds.
- Current task state: idle, running, waiting, stopping, stopped, completed, or failed.
- Progress: current index, total collection count, current cid, written count, failed count.
- Latest per-item result summary: cid, minimum price, tier count, total listing count.
- Last error message, if any.

The default behavior is:

- Start immediately when the user clicks start.
- Scan all currently collected cids once.
- Wait for the configured full-scan interval.
- Repeat until stopped.

Stopping cancels future work and any current inter-item/full-scan wait. If a
single `GetItemTradeInfo` command is already in flight, BKToolBox waits for that
command to return, then stops before the next item.

## Architecture

### Agent Responsibilities

The AutoOperation Agent exposes small IL2CPP commands only.

#### `GetCollectionItemCids`

Calls:

```text
PlayerManager.GetAllCollectionItems()
```

Returns unique positive item cids:

```json
{
  "cids": [1013007, 1032006],
  "count": 2
}
```

The command does not write `Cids.json`; BKToolBox writes it.

#### `GetItemTradeInfo`

Calls:

```text
PlayerManager.GetItemTradeInfo(itemCid)
```

The returned `Task.Result` is parsed as `List<T>`, matching the delayed price
query parser:

- `price` at object offset `24`
- `peopleCount` at object offset `28`

Returns:

```json
{
  "itemCid": 1032006,
  "resultClass": "List`1",
  "minPrice": 6200,
  "tierCount": 2,
  "totalCount": 7,
  "tiers": [
    { "price": 6200, "count": 3 },
    { "price": 6400, "count": 4 }
  ]
}
```

The existing delayed price query should reuse the same internal helper so both
paths parse trade information consistently.

### BKToolBox Responsibilities

BKToolBox owns the scan loop:

1. Ensure the AutoOperation Agent is running.
2. Call `GetCollectionItemCids`.
3. Write `Documents\BKPriceHistory\Cids.json`.
4. For each cid:
   - Call `GetItemTradeInfo`.
   - Record the returned tiers into history stores.
   - Wait `baseItemDelaySeconds + random(0..itemDelayJitterSeconds)`.
5. After all cids are processed, wait the configured full-scan interval.
6. Repeat while enabled.

The random range is additive. For example, base `5s` and jitter `5s` means each
per-item wait is `5..10s`.

### History Writes

History writes happen in BKToolBox Node/server code, not in the Agent.

For each successful item result, BKToolBox writes:

- `Documents\BKPriceHistory\items\<itemCid>.csv`
- `Documents\BKPriceHistory\ladders\<itemCid>.jsonl`
- `Documents\BKPriceHistory\latest.json`

The data contract remains compatible with current Price and high-price advisor
read paths:

- Price trend reads CSV through `PriceHistoryStore.readHistory`.
- Price latest list reads `latest.json`.
- High-price advisor reads ladder JSONL through `MarketLadderStore.readLadders`.

`latest.json` can be updated after each successful item to make partial progress
visible immediately. This is preferred over rebuilding only at the end, because
long scans can take many minutes.

### Electron, Controller, and Renderer Flow

The collection scan loop is owned by a BKToolBox singleton controller in
Electron main or Node service code. It must not be owned by the Vue component.
This keeps scan state correct when the user switches pages/tabs and later
returns to Inject.

Renderer code should call Electron/server helpers instead of writing files
directly. The Inject page is a control panel and status subscriber only.

Recommended runtime boundary:

```text
Inject renderer
  -> start/stop/updateConfig/getStatus
Electron main / Node CollectionPriceScanController
  -> window-side AutoOperation pipe client
  -> PriceHistoryStore / MarketLadderStore writes
  -> status events
Inject renderer
  <- status subscription or polling
```

The controller owns:

- Whether scanning is enabled.
- Current scan state.
- Current cid list and progress.
- Wait timers for per-item and full-scan delays.
- Cancellation flag.
- Latest result and latest error.

Representative controller state:

```json
{
  "enabled": true,
  "state": "waiting_item",
  "config": {
    "scanIntervalMinutes": 60,
    "itemDelaySeconds": 5,
    "itemJitterSeconds": 5
  },
  "itemCount": 128,
  "currentIndex": 37,
  "currentCid": 1032006,
  "completedCount": 37,
  "writtenCount": 35,
  "failedCount": 2,
  "nextItemAt": 1717296400000,
  "nextRunAt": null,
  "lastResult": {
    "itemCid": 1032006,
    "minPrice": 6200,
    "tierCount": 2,
    "totalCount": 7
  },
  "lastError": ""
}
```

The renderer requests the current status on mount. If the user navigates away
and returns, the panel must render the controller's current state rather than
starting from local component state.

`recordTradeInfoSnapshot` can be an internal controller helper. It validates and
normalizes the Agent result, then calls the existing Node stores.

The existing topbar schedule APIs can be removed from the UI path. They may stay
temporarily in preload/main code while the old path remains available, but new
work should not depend on them.

## Error Handling

- If BidKing is not running or Agent startup fails, show the error in the panel
  and do not start the loop.
- If `GetCollectionItemCids` fails, mark the scan failed and keep the panel
  stopped.
- If a single item query fails, increment `failedCount`, store the error in the
  recent result list, wait according to the configured per-item delay, and
  continue with the next cid.
- If history writing fails for an item, count that item as failed even if the
  Agent query succeeded.
- If the user stops during an inter-item or full-scan wait, stop immediately.
- If the user stops during an in-flight Agent command, stop after that command
  returns.

## Configuration

Initial defaults:

- Full-scan interval: `60` minutes.
- Per-item base wait: `5` seconds.
- Per-item random wait: `5` seconds.

Validation:

- Full-scan interval: integer `1..1440`.
- Per-item base wait: integer `0..3600`.
- Per-item random wait: integer `0..3600`.

Persist configuration in the controller's backing store or local storage so
Inject page reloads preserve the last chosen values. Runtime state must survive
page/tab navigation within the same app process, but does not need to survive a
full BKToolBox restart in the first implementation.

## Compatibility and Migration

Short term:

- Keep `BKPayload64 CollectionPrices` available as a fallback.
- Stop exposing the old topbar switch.
- The new Inject panel uses only AutoOperation Agent commands.

Later cleanup:

- Remove `BKPayload64` price scan commands and packaging resources after the new
  Agent path is verified in real use.
- Remove unused `inject-scheduler` topbar schedule wiring if no other workflow
  depends on it.

## Tests

Agent-side:

- Build `BKAutoOpAgent.dll`.
- Add or keep pure C++ tests around trade-info summary parsing.
- Verify `GetCollectionItemCids` returns deduped positive cids in a local/mockable
  helper where practical.

Node/server-side:

- Test `recordTradeInfoSnapshot` writes CSV, ladder JSONL, and latest index.
- Test invalid payload rejection.
- Test duplicate/min-price dedupe behavior remains compatible with existing
  stores.

Renderer-side:

- Test Inject panel starts by calling `GetCollectionItemCids`.
- Test per-item loop calls `GetItemTradeInfo` for each cid.
- Test stop cancels waits and prevents the next item from starting.
- Test failed item queries increment failure count and continue.
- Test config persistence.
- Test unmounting and remounting the Inject panel restores controller status.

## Acceptance Criteria

- Topbar schedule switch is no longer rendered.
- Inject page has a configurable collection-price scan panel.
- Starting the panel uses AutoOperation Agent, not `BKPayload64`.
- A scan writes `Cids.json`, CSV history, ladder JSONL, and latest index.
- Price page can read the new scan results from existing endpoints.
- High-price listing advisor can read the new ladder snapshots.
- Switching away from Inject and back shows the current scan state correctly.
- Stopping the scan prevents any further item queries after the current in-flight
  command completes.
