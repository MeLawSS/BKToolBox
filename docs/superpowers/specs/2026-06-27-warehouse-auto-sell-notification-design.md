# Warehouse Auto-Sell Completion Notification Design

## Goal

When the warehouse auto-seller completes successfully or fails, show a Windows desktop notification with the result summary.

## Non-Goals

- Do not modify `electron/services/desktop-notification.js` or the IPC layer
- Do not add i18n translation for notification text (use Chinese, consistent with Elsa auto-auction notifications)
- Do not add public notification configuration options to the composable

## Current Context

The project already has a complete desktop notification pipeline:

1. `electron/services/desktop-notification.js` — `showDesktopNotification({title, body})` using Electron's `Notification` API
2. `electron/main.js` — `ipcMain.handle('app:showNotification', ...)` routes to the service
3. `electron/preload.js` — exposes `showNotification: (title, body) => ipcRenderer.invoke(...)` on `window.bidkingDesktop`
4. `src/elsa/useElsaAutoOperation.js` — existing precedent: `showDesktopNotification(title, body)` helper that calls `window.bidkingDesktop?.showNotification`

The warehouse auto-seller (`src/price/useWarehouseAutoSeller.js`) currently transitions to terminal phases without any notification:

```javascript
// success path (all candidates processed)
if (!candidate) {
  phase.value = 'completed';
  return;
}

// failure path
if (outcome === 'failed') {
  phase.value = 'failed';
  return;
}
```

At these terminal points, `successCount`, `skippedCount`, and `lastError` refs already hold the summary data.

## Design Summary

Add notification calls in `src/price/useWarehouseAutoSeller.js` immediately before the two terminal `phase` assignments. Follow the existing Elsa pattern: call `window.bidkingDesktop?.showNotification(title, body)` inside a try/catch, log warnings on failure, never block the selling flow.

## Implementation

### New helper: `_notifyCompletion`

Add inside `useWarehouseAutoSeller` (after `_cancelableSleep`, before `_getNextCandidate`):

```javascript
async function _notifyCompletion(title, body) {
  const notify = window.bidkingDesktop?.showNotification;
  if (typeof notify !== 'function') return;
  try {
    const result = await notify(title, body);
    if (!result?.ok) {
      console.warn(`Desktop notification failed: ${result?.error || 'unknown error'}`);
    }
  } catch (e) {
    console.warn(`Desktop notification failed: ${e?.message || e}`);
  }
}
```

This structure mirrors `useElsaAutoOperation.js`'s `showDesktopNotification`, with one difference: it uses `console.warn` instead of the Elsa-specific `addLog` (the auto-seller composable has no logging infrastructure).

### Notification call sites

Three terminal paths in `start()` receive notification calls:

Notification title follows the Elsa convention: fixed app name `BKToolBox`, with the event description in the body.

**1. Completion** — all candidates processed, insert before `phase.value = 'completed'`:

```javascript
if (!candidate) {
  await _notifyCompletion(
    'BKToolBox',
    `自动售卖完成，成功上架 ${successCount.value} 件，跳过 ${skippedCount.value} 件`
  );
  phase.value = 'completed';
  return;
}
```

**2. Item-processing failure** — `_processItem` returned `'failed'`, insert before `phase.value = 'failed'`:

```javascript
if (outcome === 'failed') {
  await _notifyCompletion(
    'BKToolBox',
    `自动售卖失败：${lastError.value || '未知错误'}`
  );
  phase.value = 'failed';
  return;
}
```

**3. Initial snapshot failure** — warehouse refresh failed before any items processed:

```javascript
if (!snap.ok) {
  lastError.value = snap.error ?? errors.loadWarehouseFailed;
  await _notifyCompletion(
    'BKToolBox',
    `自动售卖失败：${lastError.value}`
  );
  phase.value = 'failed';
  return;
}
```

**4. Snapshot-after-success failure** — selling was in progress but a subsequent warehouse refresh failed:

```javascript
if (!snapAfter.ok) {
  lastError.value = snapAfter.error ?? errors.warehouseRefreshAfterSuccessFailed;
  await _notifyCompletion(
    'BKToolBox',
    `自动售卖失败：${lastError.value}`
  );
  phase.value = 'failed';
  return;
}
```

### Behavior constraints

- Notification fires only in desktop environment (`window.bidkingDesktop?.showNotification` exists)
- If notification is unsupported or unavailable, the helper silently returns — no error, no block
- If the notification API call throws or returns `{ ok: false }`, a warning is logged to console, but the selling flow continues uninterrupted
- `await` on the notification call means the phase assignment happens after the notification attempt, but since notification is fire-and-forget (no retry), this ordering is acceptable and avoids any race with the consuming UI

## Error Handling

| Scenario | Behavior |
|---|---|
| `window.bidkingDesktop` is undefined | `_notifyCompletion` returns immediately, no error |
| `showNotification` is not a function | `_notifyCompletion` returns immediately |
| Notification returns `{ ok: false }` | `console.warn`, flow continues |
| Notification throws | caught by try/catch, `console.warn`, flow continues |
| Notification succeeds | user sees desktop toast |

## Testing

Update `src/price/App.test.js` (which already exercises the auto-seller lifecycle):

### 1. Completion notification

Mock `window.bidkingDesktop.showNotification` as a `vi.fn().mockResolvedValue({ ok: true, shown: true })`. Run the auto-seller through to completion with multiple items. Assert:
- `showNotification` was called exactly once
- First argument is `'BKToolBox'`
- Second argument contains `'自动售卖完成'` and the success count and skipped count

### 2. Failure notification — item processing error

Cause a failure (e.g., mock `GetItemTradeInfo` to return `{ ok: false }`). Assert:
- `showNotification` was called with `'BKToolBox'` and a body containing `'自动售卖失败'` and the error message

### 3. Failure notification — initial snapshot failure

Mock `refreshWarehouseSnapshot` to return `{ ok: false, error: 'Warehouse refresh failed' }`. Assert:
- `showNotification` was called with `'BKToolBox'` and a body containing `'自动售卖失败'` and `'Warehouse refresh failed'`

### 4. Failure notification — snapshot-after-success failure

Mock `refreshWarehouseSnapshot` to succeed on the first call (allowing at least one item to sell) then fail on a subsequent call. Assert:
- `showNotification` was called with `'BKToolBox'` and a body containing `'自动售卖失败'` and the snapshot error

### 5. Non-desktop environment

Set `window.bidkingDesktop = undefined`. Run auto-seller to completion. Assert:
- No exception thrown
- `phase.value === 'completed'`

## Documentation Update

Update `docs/Documentation.md` under the auto-seller section to note:
- When auto-sell completes or fails in a desktop environment, a Windows desktop notification is shown (requires `bidkingDesktop` bridge)

## Acceptance Criteria

- Auto-seller completion fires a Windows notification with success/skipped counts
- Auto-seller failure fires a Windows notification with the error message
- Notification failure does not block or crash the auto-seller
- In non-desktop environments, the auto-seller completes normally without errors
- New tests pass
- Existing auto-seller tests pass without modification
- `git diff --check`, `npm test`, and `npm run build:pages` pass
