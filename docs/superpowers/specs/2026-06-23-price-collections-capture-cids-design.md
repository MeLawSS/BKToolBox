# Price Collections Capture CIDs Button Design

Date: 2026-06-23
Branch: `feat/price-collections-capture-cids`

## Summary

Add a manual button to the `price` page `collections` panel that captures the player's in-game collected collectible list and writes it to the existing `Documents/BKPriceHistory/Cids.json` file. After a successful capture, refresh the `collections` panel from the existing HTTP endpoints so the UI reflects the newly written file immediately.

This work stays scoped to the `price` page renderer plus the Electron bridge and service layer needed to expose a one-shot "capture and write collection CIDs" action. It does not change the background collection price scan flow, file format, or collections HTTP API contract.

## Goals

- Add a visible manual action in the `price` page `collections` panel.
- Reuse the existing native command `GetCollectionItemCids`.
- Reuse the existing file writer `recordCollectionCids(...)`.
- Keep `Documents/BKPriceHistory/Cids.json` as the single on-disk source for collections.
- Refresh the panel after success so the UI stays consistent with the file.

## Non-Goals

- No background scheduler or periodic capture loop.
- No new file location, naming scheme, or user-configurable path.
- No reuse of the collection price scan controller state machine for this button.
- No new toast/notification framework in the `price` page.
- No merge back to `master` as part of this task.

## Current Context

### Existing renderer flow

- `src/price/App.vue` already has a `collections` tab with a single refresh button.
- The panel reads its data from `/api/price-history/collections`.
- The same file also already uses `window.bidkingDesktop.runAutoOperationCommand('GetCollectionItemCids', {})` for live warehouse filtering, proving the renderer can request the native collection list.

### Existing native file-writing flow

- `lib/trade-info-history-recorder.js` already exports `recordCollectionCids(cids)`.
- `recordCollectionCids(...)` normalizes positive integer CIDs, de-duplicates them, and writes `Cids.json` under `Documents/BKPriceHistory`.
- `electron/services/collection-price-scan-controller.js` already uses `GetCollectionItemCids` followed by `recordCollectionCids(cids)` during a background scan cycle.

### Existing bridge pattern

- `electron/preload.js` exposes desktop APIs through `window.bidkingDesktop`.
- `electron/main.js` wires IPC handlers and returns `{ ok: false, error }` on failures.
- `electron/services/inject-service.js` already owns native auto-operation command execution and timeout policy.

## Assumptions

- The button is a manual, one-shot capture action initiated by the user from the `price` page.
- The correct output location remains `Documents/BKPriceHistory/Cids.json`, because the `collections` page already reads from that storage pipeline.
- The button should self-start the required native capability instead of requiring the user to start the AutoOperation Agent first.
- If capture succeeds, the page should continue reading through `/api/price-history/collections` instead of bypassing the existing server path.
- The current dirty state in unrelated repository areas is out of scope and must not be modified.

## Approaches Considered

### Approach A: Dedicated Electron bridge action

Add a dedicated desktop API such as `captureCollectionCidsToFile()`. The Electron side handles the entire chain:

1. ensure/start the AutoOperation Agent
2. run `GetCollectionItemCids`
3. write `Cids.json` via `recordCollectionCids(...)`
4. return structured result data to the renderer

Pros:

- Keeps file-system and native-command details out of the renderer.
- Reuses the existing recorder contract and storage path.
- Centralizes error handling and future reuse.

Cons:

- Requires changes in preload, main-process IPC wiring, and service code.

### Approach B: Renderer stitches together command + file write

Let the renderer call `GetCollectionItemCids`, then write the file through a generic desktop API such as `writeDataFile`.

Pros:

- Surface-level fewer moving parts.

Cons:

- `writeDataFile` currently targets `Documents/BidKing`, not `Documents/BKPriceHistory`.
- Duplicates JSON serialization and path knowledge in the renderer.
- Splits the existing collection storage contract across layers.

### Approach C: Reuse collection scan controller for a one-shot export

Drive the existing background collection scan controller to do only the CID capture portion.

Pros:

- Reuses an existing pipeline that already writes `Cids.json`.

Cons:

- Pulls in unrelated scan state, progress tracking, and trade-info recording flow.
- Adds a much larger blast radius than the UI button needs.

## Decision

Use Approach A.

This is the smallest change that preserves the current architecture boundaries:

- renderer triggers user intent
- Electron service owns native interaction
- recorder owns file output semantics

## Design

### Renderer changes

Update `src/price/App.vue`:

- Add a second button in the `collections` panel header, next to the existing refresh button.
- Add a dedicated busy flag such as `isCapturingCollections`.
- Add a computed capability guard that checks `window.bidkingDesktop?.isDesktop` and `typeof window.bidkingDesktop?.captureCollectionCidsToFile === 'function'`.
- Add a new action that:
  1. exits early if capture is unavailable or already running
  2. clears any previous top-level error text
  3. calls `window.bidkingDesktop.captureCollectionCidsToFile()`
  4. throws if the bridge returns `ok === false`
  5. on success, awaits the existing `refreshCollections()`
  6. on failure, sets `errorText`
  7. always clears the busy flag

UI behavior:

- While capture is running, disable both the new capture button and the existing refresh button.
- The capture button text changes to a busy-state label.
- No new detail panel or modal is added.

### Renderer state boundaries

- Keep `isCapturingCollections` separate from `isRefreshingCollections`.
- Do not update `collectionCids` directly from the native capture response.
- Use `refreshCollections()` after success so `/api/price-history/collections` remains the single read path for this panel.

### Desktop bridge changes

Update `electron/preload.js`:

- Expose `captureCollectionCidsToFile: () => ipcRenderer.invoke('inject:captureCollectionCidsToFile')`

Update `electron/main.js`:

- Add `ipcMain.handle('inject:captureCollectionCidsToFile', async () => ...)`
- Preserve the existing return convention:
  - success returns the service result
  - failure returns `{ ok: false, error: error.message }`

### Service-layer changes

Add a dedicated helper in `electron/services/inject-service.js`:

- Helper name: `captureCollectionCidsToFile(deps = {})`

Behavior:

1. call `startAutoOperationAgent(...)`
2. call `runAutoOperationCommand('GetCollectionItemCids', {}, deps)`
3. extract `response?.value?.cids` and normalize it to an array
4. call `recordCollectionCids(cids, deps)`
5. return:

```js
{
  ok: true,
  value: {
    itemCids,
    count: itemCids.length,
    outputPath,
  },
}
```

Implementation notes:

- Keep `GetCollectionItemCids` timeout behavior unchanged by reusing the existing command timeout rules in `runAutoOperationCommand`.
- Reuse the same root directory logic as `recordCollectionCids(...)`.
- Expose `outputPath` explicitly so the result is inspectable in tests and future UI work.

### Recorder contract adjustment

Update `lib/trade-info-history-recorder.js` so `recordCollectionCids(...)` returns the resolved output path in addition to the normalized CID array:

```js
{ written: true, itemCids, outputPath }
```

This is backward-compatible for current callers that only inspect `written` and `itemCids`, while making the new bridge result precise.

## Error Handling

Renderer:

- If the feature is unavailable in the current environment, set `errorText` with the same style used by other `price` page failures.
- If the capture bridge throws or returns `ok: false`, surface the error message in `errorText`.
- Do not mutate `collectionCids` on failure.

Electron:

- IPC handler catches thrown errors and returns `{ ok: false, error }`.
- Service helper throws on invalid or failed native command execution the same way existing helpers do.

Native-data edge cases:

- Empty collection lists are allowed and should write `[]` to `Cids.json`.
- Invalid CID values should continue to be ignored by `recordCollectionCids(...)`.
- Duplicate CID values should continue to be de-duplicated in write order.

## Testing

### Targeted baseline

Before feature changes, the following relevant tests pass in the isolated worktree:

- `src/price/App.test.js`
- `electron/services/inject-service.test.mjs`
- `electron/services/collection-price-scan-controller.test.mjs`
- `lib/trade-info-history-recorder.test.mjs`

The repository-wide `npm test` baseline is currently red in unrelated areas (`server`, `scripts`, `ethan`, `inject/controllerUiNodeLabels`) and is not part of this feature scope.

### New test coverage

Update `src/price/App.test.js`:

- renders the new collections capture button
- clicking capture calls the new desktop bridge and then refreshes `/api/price-history/latest` and `/api/price-history/collections`
- while capture is running, both collections header buttons are disabled
- capture failure shows an error and does not trigger the collections refresh fetches

Update `electron/services/inject-service.test.mjs`:

- success path returns `{ ok: true, value: { itemCids, count, outputPath } }`
- native command failure propagates as a rejected operation / `ok: false` IPC result
- helper starts the auto-operation agent before requesting collection CIDs

Update `lib/trade-info-history-recorder.test.mjs`:

- assert the returned `outputPath` matches the written `Cids.json`

Regression expectations:

- existing collection scan controller tests continue to pass after the recorder result shape grows
- existing warehouse live-collection logic remains unchanged

## Verification Plan

Feature verification after implementation:

1. run targeted tests for the modified areas
2. run `npm run build:price`
3. optionally run the desktop app manually and confirm the button writes `Documents/BKPriceHistory/Cids.json`

## Deliverables

- `price` page collections header button and busy/error behavior
- Electron preload/main/service support for one-shot collection capture to file
- recorder return-shape update if needed for `outputPath`
- focused automated test updates
