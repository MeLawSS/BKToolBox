# Tools Minimum Cells Debugger Disk History Design

## Goal

Extend the existing `Tools` V2 minimum-cells debugger so every completed calculation is persisted in two places:

- existing browser `localStorage` history for in-panel restore and recalculate
- a durable on-disk NDJSON log for later debugging outside the app

The new disk persistence must be automatic on each calculation run and must not change the current debugger interaction model.

## Non-Goals

- Do not replace the current `localStorage` history source used by the panel.
- Do not add a disk-history browser or import flow in this round.
- Do not dedupe disk entries across repeated identical runs.
- Do not add retry queues, background syncing, or offline recovery.
- Do not persist unfinished draft matrix state to disk.

## Current Context

### Existing debugger history

[`src/elsa/useMinimumCellsDebugger.js`](../../../src/elsa/useMinimumCellsDebugger.js) already:

- computes one history entry per successful `calculate()`
- writes the entry into `localStorage`
- restores and recalculates from `localStorage` history only

The serializable history entry shape is defined in [`src/elsa/minimum-cells-debugger.js`](../../../src/elsa/minimum-cells-debugger.js) through `createHistoryEntry(...)`.

### Existing server persistence patterns

The repo already has small dedicated store modules for document-backed history:

- [`lib/bidking-price-history-store.js`](../../../lib/bidking-price-history-store.js)
- [`lib/bidking-market-price-store.js`](../../../lib/bidking-market-price-store.js)

Those stores:

- compute a fixed root directory
- validate and normalize incoming records
- create directories lazily
- write JSON or NDJSON on disk

The server already exposes JSON APIs from [`server.js`](../../../server.js), with `express.json(...)` enabled and route-level validation behavior established.

### Existing Documents root helper

[`runtime-paths.js`](../../../runtime-paths.js) exposes `getDocumentsDir()`, which already centralizes the app's persistent documents root. This is the correct base for debugger disk history as well.

## Chosen Approach

Keep `localStorage` as the panel's live history mechanism and add one server-backed append-only disk log.

The flow after this change is:

1. the debugger still computes the algorithm result in-browser
2. the debugger still writes the same entry to `localStorage`
3. the debugger then `POST`s that same entry to a new server endpoint
4. the server validates and appends one JSON line to a disk file

This keeps UI recovery fast and unchanged while giving debugging sessions a durable file trail outside the browser.

## Disk Storage Design

### Location

Persist entries under:

`Documents/BKToolBox/min-cells-debugger-history/history.ndjson`

Concrete path construction:

- base directory: `getDocumentsDir()`
- feature directory: `BKToolBox/min-cells-debugger-history`
- log file: `history.ndjson`

This keeps debugger output separate from existing `BKPriceHistory` data while staying inside the same Documents-root persistence model used elsewhere in the repo.

### File format

The disk file is newline-delimited JSON.

Each line contains one full debugger history entry with the existing frontend fields:

- `id`
- `createdAt`
- `version`
- `grid`
- `outlines`
- `result`
- `summary`

The server adds two fields before writing:

- `savedAt`: server-side ISO timestamp for when the file write happened
- `source`: fixed string `"tools-min-cells-debugger"`

Example logical shape:

```json
{
  "id": "hist-1760000000000-ab12cd",
  "createdAt": "2026-06-25T06:00:00.000Z",
  "version": 1,
  "grid": { "rows": 43, "columns": 10 },
  "outlines": [
    { "boxId": 12, "width": 2, "height": 3, "cells": [12, 13, 22, 23, 32, 33] }
  ],
  "result": {
    "valid": true,
    "minTotalCells": 19,
    "knownOutlineCellCount": 6,
    "unknownBlockingCellCount": 5,
    "unknownBlockingCells": [41, 42],
    "order": [12],
    "holeCells": []
  },
  "summary": "1 / 6 / 19",
  "savedAt": "2026-06-25T06:00:01.234Z",
  "source": "tools-min-cells-debugger"
}
```

NDJSON is preferred here because:

- each calculation naturally maps to one append-only event
- later debugging is easy with text tools and scripts
- writes stay simple and do not require rewriting a whole array file

## API Design

Add one endpoint in [`server.js`](../../../server.js):

- `POST /api/tools/min-cells-debugger/history`

Request body:

```json
{
  "entry": {
    "id": "hist-1760000000000-ab12cd",
    "createdAt": "2026-06-25T06:00:00.000Z",
    "version": 1,
    "grid": { "rows": 43, "columns": 10 },
    "outlines": [
      { "boxId": 12, "width": 2, "height": 3, "cells": [12, 13, 22, 23, 32, 33] }
    ],
    "result": {
      "valid": true,
      "minTotalCells": 19,
      "knownOutlineCellCount": 6,
      "unknownBlockingCellCount": 5,
      "unknownBlockingCells": [41, 42],
      "order": [12],
      "holeCells": []
    },
    "summary": "1 / 6 / 19"
  }
}
```

Success response:

```json
{
  "ok": true,
  "savedAt": "2026-06-25T06:00:01.234Z",
  "outputPath": "C:\\Users\\alice\\Documents\\BKToolBox\\min-cells-debugger-history\\history.ndjson"
}
```

Failure behavior:

- `400` when the request body does not match the expected entry shape
- `500` when the server cannot create directories or append the file

No read endpoint is added in this round.

## Server-Side Store Design

Add a new module:

[`lib/bidking-min-cells-debugger-history-store.js`](../../../lib/bidking-min-cells-debugger-history-store.js)

Its responsibilities are:

- build the feature directory from `getDocumentsDir()`
- validate the incoming entry shape
- add `savedAt` and `source`
- append one line to `history.ndjson`

The store exposes one main method: `recordEntry(entry)`, returning:

```json
{
  "written": true,
  "savedAt": "2026-06-25T06:00:01.234Z",
  "outputPath": "C:\\Users\\alice\\Documents\\BKToolBox\\min-cells-debugger-history\\history.ndjson"
}
```

Validation requirements:

- `id` must be a string
- `createdAt` must parse as a valid date
- `version` must equal `1`
- `grid.rows` must equal `43`
- `grid.columns` must equal `10`
- `outlines` must be an array
- every outline must include numeric `boxId`, `width`, `height`, and `cells[]`
- `summary` must be a string
- `result` may be `null` or an object

The store does not need to validate every semantic detail of the algorithm result. It only needs to reject obviously malformed payloads.

## Frontend Integration

Update [`src/elsa/useMinimumCellsDebugger.js`](../../../src/elsa/useMinimumCellsDebugger.js) so `calculate()` does the following in order:

1. compute the algorithm result
2. update `result.value`
3. create the history entry
4. save the entry to `localStorage`
5. send the same entry to `POST /api/tools/min-cells-debugger/history` after local persistence has already succeeded

Important behavior constraints:

- disk-write failure must not roll back `result.value`
- disk-write failure must not remove the `localStorage` entry
- restore and recalculate continue to use `localStorage` only
- no automatic retry is added

The fetch request should be awaited only for its own success or failure handling. It must not delay local result rendering or local history persistence, and it must not be moved into a retry queue in this round.

## Error Handling

The debugger already exposes `storageError` in the panel. Extend its meaning so the panel can surface disk persistence failures clearly.

Required behavior:

- if `localStorage` write fails, keep the existing storage error behavior
- if disk persistence fails, show a dedicated debugger error message indicating that local history succeeded but file persistence failed
- if disk persistence later succeeds on another run, clear the stale disk error state

This preserves the difference between:

- total calculation failure
- local history persistence failure
- disk history persistence failure

## Testing

Follow TDD for each layer.

### 1. Store unit tests

Add a new test file for the disk-history store and verify:

- valid entries create `BKToolBox/min-cells-debugger-history/history.ndjson`
- one call appends exactly one JSON line
- two valid calls produce two lines
- malformed entries are rejected and no line is written

Use a temp documents directory via `BIDKING_DOCUMENTS_DIR` or explicit constructor injection, matching the repo's current filesystem test style.

### 2. Server route tests

Extend [`server.test.mjs`](../../../server.test.mjs) to verify:

- `POST /api/tools/min-cells-debugger/history` returns `200` and the success payload for a valid entry
- malformed payload returns `400`
- store write failures return `500`

### 3. Frontend integration tests

Extend [`src/elsa/App.test.js`](../../../src/elsa/App.test.js) to verify:

- a successful debugger calculation still writes `localStorage` history
- the calculation also performs a `fetch('/api/tools/min-cells-debugger/history', ...)`
- a failed disk-persistence response does not remove the visible result or `localStorage` history
- a failed disk-persistence response surfaces the correct error state

## Acceptance Criteria

Done when all of the following are true:

- every successful debugger calculation still appears in the panel history immediately
- every successful debugger calculation also appends one line to `Documents/BKToolBox/min-cells-debugger-history/history.ndjson`
- the appended line contains the full debugger entry plus `savedAt` and `source`
- disk persistence failure does not break result display or local replay history
- malformed API payloads are rejected server-side
- new unit, route, and frontend tests cover the feature

## Risks And Mitigations

### Risk: duplicated history between local and disk stores

Accepted in this round. The two stores serve different purposes:

- `localStorage` for live panel UX
- NDJSON for durable debugging records

### Risk: repeated identical calculations create duplicate file lines

Accepted in this round. The debugger is intended as an explicit testing workbench, and exact reruns are often useful during debugging.

### Risk: disk path assumptions vary by environment

Mitigation:

- use `getDocumentsDir()` as the only path root
- allow tests to override the documents root through existing environment-based patterns
