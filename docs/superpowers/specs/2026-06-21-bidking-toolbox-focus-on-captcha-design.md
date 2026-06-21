# BKToolBox Focus-On-Captcha Design

**Goal:** When the native agent detects a slide-verification (captcha) screen during `AutoAuction`, in addition to the existing Windows desktop notification, automatically bring the BKToolBox window to the foreground so the user can see the alert and act on it without hunting for the window.

## Current Facts

1. `CmdAutoAuction` in `MetaOperations.cpp` returns `{ status: 'authcode_required' }` when it detects a captcha screen.
2. `useElsaAutoOperation.js` `runScript()` (line 220–224) handles this by:
   - Logging the warning message
   - Calling `stopAutomation({ requestCancel: false })`
   - Calling `showDesktopNotification('BKToolBox', '检测到验证界面，已停止自动竞拍，请手动完成验证。')`
   - Returning early
3. `showDesktopNotification` in `electron/services/desktop-notification.js` uses the Electron `Notification` API and already has internal try/catch.
4. BKToolBox `mainWindow` is a `BrowserWindow` created in `electron/main.js:createMainWindow()` (line 718). It supports `restore()`, `show()`, and `focus()`.
5. Renderer-to-main IPC uses the `window.bidkingDesktop` bridge defined in `electron/preload.js`.

## Decision

Add a **generic `app:focusMainWindow` IPC** that brings the BKToolBox main window to the foreground. The captcha-detection path is the first (and currently only) caller.

This is a one-shot foreground action — not `setAlwaysOnTop`. After the window comes to the front, normal window Z-order behavior resumes.

## Rejected Alternatives

### 1. Call focusMainWindow directly in the renderer without an IPC

Rejected because renderer code has no access to `BrowserWindow` APIs. The preload bridge is the correct boundary.

### 2. Inline the window-focus logic inside the existing `app:showNotification` handler

Rejected because notification and window focus are orthogonal concerns. A generic `focusMainWindow` IPC is independently useful and follows the existing pattern (`showNotification` is its own IPC too).

### 3. Use `setAlwaysOnTop(true)` temporarily

Rejected as overkill. The user asked for a one-shot bring-to-front, not persistent pinning. Restoring + showing + focusing is sufficient.

## Implementation Details

### 1. New IPC handler in `electron/main.js`

Add inside `registerIpc()`, alongside the existing `app:showNotification` handler:

```js
ipcMain.handle('app:focusMainWindow', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, error: 'no window' };
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return { ok: true };
});
```

Requirements:

- `restore()` before `show()`/`focus()` to handle the minimized case
- Return `{ ok: false, error: 'no window' }` when `mainWindow` is null or destroyed (e.g., during shutdown); callers may silently ignore this result
- No `setAlwaysOnTop` — this is a one-shot foreground action

### 2. New preload bridge in `electron/preload.js`

Add to the existing `window.bidkingDesktop` API object:

```js
focusMainWindow: () => ipcRenderer.invoke('app:focusMainWindow'),
```

### 3. Call site in `src/elsa/useElsaAutoOperation.js`

In `runScript()`, the `authcode_required` branch becomes:

```js
if (status === AUTO_AUCTION_AUTH_CODE_RESULT) {
    addLog(AUTO_AUCTION_AUTH_CODE_MESSAGE, 'warn');
    await stopAutomation({ requestCancel: false });
    await showDesktopNotification(AUTO_AUCTION_NOTIFICATION_TITLE, AUTO_AUCTION_AUTH_CODE_MESSAGE);
    try {
        await window.bidkingDesktop?.focusMainWindow?.();
    } catch (_e) {
        // focus is best-effort; never block the shutdown flow
    }
    return;
}
```

Key points:

- `try/catch` with empty catch — focus is best-effort; a failure must not propagate into the `runScript` promise chain or block the `stopAutomation` cleanup that already ran
- Optional chaining `?.` on both `bidkingDesktop` and `focusMainWindow` — in a non-desktop environment (e.g., browser dev mode), neither exists and the call is silently skipped
- Call order: notification fires first (so the user gets the system toast even if the window focus fails), then focus

### 4. Error handling contract

| Scenario | Behavior |
|---|---|
| `mainWindow` is null or destroyed | IPC returns `{ ok: false }`, caller ignores |
| `bidkingDesktop` is undefined (browser dev) | Optional chaining skips the call |
| IPC throws (pipe broken, main process dead) | try/catch swallows; no unhandled rejection |
| Window successfully focused | User sees BKToolBox in foreground |

## Non-Goals

- No `setAlwaysOnTop` / persistent pinning
- No configurable behavior — always focus on captcha
- No UI toggle for this feature
- No change to `showDesktopNotification` or its IPC
- No focus-stealing prevention (Windows default focus-stealing rules apply)

## Testing

### Manual verification

1. Start an `AutoAuction` that eventually hits a captcha screen
2. Verify BKToolBox window restores from minimized state and comes to foreground
3. Verify the Windows notification still fires as before

### Automated testing

- `useElsaAutoOperation.test.js`: extend the existing authcode-required test to verify `focusMainWindow` is called on the bridge. Mock `bidkingDesktop.focusMainWindow` and assert it was invoked after the notification.

## Acceptance Criteria

1. When `AutoAuction` returns `authcode_required`, BKToolBox window is restored (if minimized) and brought to the foreground.
2. The existing Windows notification still fires in the same sequence.
3. If the BKToolBox window does not exist (e.g., during shutdown), no error propagates to the user.
4. No change in behavior for non-desktop (browser dev) environments.
5. No new UI surface is introduced.
