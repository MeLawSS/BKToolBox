# BKToolBox Focus-On-Captcha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When AutoAuction detects a captcha screen, bring the BKToolBox window to the foreground (restore if minimized, then show + focus).

**Architecture:** New generic `app:focusMainWindow` IPC (renderer → main process). Captcha-detection path in `useElsaAutoOperation.js` is the first caller. Three files changed, one test extended.

**Tech Stack:** Electron BrowserWindow API, Electron IPC (ipcMain.handle / ipcRenderer.invoke), Vue 3 Composition API, Vitest + happy-dom

## Global Constraints

- Focus is one-shot (restore + show + focus), NOT `setAlwaysOnTop`
- try/catch around the IPC call; focus failure must never block the shutdown flow
- Optional chaining on `bidkingDesktop?.focusMainWindow?.()` for non-desktop environments
- Call order: notification fires first, then focus
- Return `{ ok: false, error: 'no window' }` when mainWindow is null or destroyed

---

### Task 1: Electron IPC handler + preload bridge

**Files:**
- Modify: `electron/main.js:709-715` — add `app:focusMainWindow` IPC handler alongside `app:showNotification`
- Modify: `electron/preload.js:50-51` — add `focusMainWindow` bridge method alongside `showNotification`

**Interfaces:**
- Produces: `window.bidkingDesktop.focusMainWindow()` → `ipcRenderer.invoke('app:focusMainWindow')` → returns `{ ok: boolean, error?: string }`

- [ ] **Step 1: Add IPC handler in electron/main.js**

In `registerIpc()`, add after the `app:showNotification` handler (line 715):

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

- [ ] **Step 2: Add preload bridge in electron/preload.js**

Add after the `showNotification` line (line 51):

```js
    focusMainWindow: () => ipcRenderer.invoke('app:focusMainWindow'),
```

- [ ] **Step 3: Verify syntax**

Run: `node -c electron/main.js && node -c electron/preload.js`
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat: add focusMainWindow IPC to bring BKToolBox to foreground"
```

---

### Task 2: Call focusMainWindow on captcha detection + test

**Files:**
- Modify: `src/elsa/useElsaAutoOperation.js:220-225` — add `focusMainWindow()` call in authcode_required branch
- Modify: `src/elsa/useElsaAutoOperation.test.js` — add `focusMainWindow` to mock bridge, extend existing test, add new test

**Interfaces:**
- Consumes: `window.bidkingDesktop.focusMainWindow()` from Task 1

- [ ] **Step 1: Add focusMainWindow to mock + write failing tests**

In `beforeEach` (line 83), add after `showNotification`:

```js
        focusMainWindow: vi.fn().mockResolvedValue({ ok: true }),
```

Extend the existing authcode test — add one assertion after the `showNotification` expectation at line 442:

```js
        expect(window.bidkingDesktop.focusMainWindow).toHaveBeenCalled();
```

Add a new test after line 448 (after the closing `});` of the existing "stops auto operation and shows a desktop notification" test):

```js
    it('does not propagate focusMainWindow rejection when captcha is detected', async () => {
        vi.useFakeTimers();
        monitorRunning = true;
        mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
        elsaExpectedPrice.value = 50000;
        window.bidkingDesktop.focusMainWindow.mockRejectedValue(new Error('pipe broken'));
        window.bidkingDesktop.runAutoOperationCommand.mockResolvedValue({
            ok: true,
            value: { result: 'authcode_required', rounds: 0, expectedPrice: 50000 },
            response: {},
        });
        const { result, wrapper } = withSetup(() => useElsaAutoOperation());
        try {
            await result.enable();
            await flushPromises();
            await advanceInitialExpectedPriceSync();

            expect(result.isEnabled.value).toBe(false);
            expect(mockUnloadAgent).toHaveBeenCalledTimes(1);
            expect(window.bidkingDesktop.showNotification).toHaveBeenCalled();
            expect(window.bidkingDesktop.focusMainWindow).toHaveBeenCalled();
            // No unhandled rejection — test completes without error
        } finally {
            wrapper.unmount();
            vi.useRealTimers();
        }
    });
```

- [ ] **Step 2: Run tests — verify they FAIL**

Run: `npx vitest run src/elsa/useElsaAutoOperation.test.js`
Expected: 2 FAILURES — the existing authcode test now asserts `focusMainWindow` was called but it isn't yet; the new test also fails.

- [ ] **Step 3: Implement the focusMainWindow call in useElsaAutoOperation.js**

In `runScript()`, replace the `authcode_required` branch (lines 220-225):

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

- [ ] **Step 4: Run tests — verify they PASS**

Run: `npx vitest run src/elsa/useElsaAutoOperation.test.js`
Expected: All 17 tests PASS (15 original + 1 extended assertion + 1 new test)

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/elsa/useElsaAutoOperation.js src/elsa/useElsaAutoOperation.test.js
git commit -m "feat: focus BKToolBox window on captcha detection during AutoAuction"
```
