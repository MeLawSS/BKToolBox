# Elsa Auto Auction Debounced Price Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Elsa auto auction keep writing the `Price` file immediately, but gate agent startup and in-round bidding off a 4-second debounced `SetExpectedPrice` sync instead of the old file-reader + `secs < 15` timing.

**Architecture:** Split the work into app-side orchestration and native-side execution. App-side `useElsaAutoOperation.js` gains a debounced side-band `SetExpectedPrice` pipeline, an initial-sync promise gate, and abort-safe startup so `enable()` stays non-blocking. Native-side `MetaOperations.cpp` drops the file-reader price source, keeps only `SetExpectedPrice`-backed state, preserves the existing opponent-cap block unchanged, and uses tiny pure helpers in `AggregateOperationSemantics.h` to lock the new/unchanged bid-loop guards in unit tests.

**Tech Stack:** Vue 3 Composition API, Vitest + `happy-dom`, C++11 native agent, WSL MinGW cross-build via `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

---

## Global Constraints

- No TypeScript — plain `.js` and `.cpp`
- Preserve `writeDataFile('Price', String(price || 0))` immediate behavior; the file is no longer authoritative for AutoAuction timing
- `enable()` must not stay busy for the 4-second initial debounce window
- `disable()` must be able to stop Elsa during the initial wait window
- `useExpectedPrice` path removes the `secs < 15` gate; legacy `bidAmount` path keeps it
- Keep the current opponent-cap logic in `MetaOperations.cpp` intact; only change the source/timing of `amount`
- Remove `g_expectedPrice` and the price-reader thread helpers completely; do not leave dual price sources in the DLL
- Rebuild `BKAutoOpAgent.dll` with WSL after native changes

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/elsa/useElsaAutoOperation.js` | Debounced `SetExpectedPrice`, initial-sync gate, abort-safe startup |
| Modify | `src/elsa/useElsaAutoOperation.test.js` | Fake-timer regression coverage for debounce, gating, disable, and live-sync failures |
| Modify | `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` | Small pure bid-loop helpers for testable gate logic |
| Modify | `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` | Assert helper semantics for expected-price path, legacy timed path, round advancement, and reported-price fallback |
| Modify | `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` | Remove file-reader source; wire `g_notifiedExpectedPrice` into `CmdSetExpectedPrice` and `CmdAutoAuction` |
| Output | `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll` | Rebuilt native DLL |

---

### Task 1: App-Side Tests First

**Files:**
- Modify: `src/elsa/useElsaAutoOperation.test.js`

**Interfaces:**
- Exercises: `useElsaAutoOperation()` from `src/elsa/useElsaAutoOperation.js`
- Mocks: `window.bidkingDesktop.runAutoOperationCommand`, `window.bidkingDesktop.writeDataFile`, `useMonitorSwitch`, `useAutoOperationAgentSwitch`

- [ ] **Step 1: Add the failing debounce/gating tests**

Append these tests near the bottom of `src/elsa/useElsaAutoOperation.test.js`, after the current authcode notification coverage:

```js
  it('waits for the first debounced SetExpectedPrice before starting AutoAuction', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    const autoAuctionPromise = new Promise(() => {});
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
      }
      if (name === 'AutoAuction') {
        return autoAuctionPromise;
      }
      if (name === 'CancelAutoAuction') {
        return Promise.resolve({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 100000 }, response: {} });
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();

    expect(result.isEnabled.value).toBe(true);
    expect(result.isBusy.value).toBe(false);
    expect(window.bidkingDesktop.writeDataFile).toHaveBeenCalledWith('Price', '100000');
    expect(window.bidkingDesktop.runAutoOperationCommand).not.toHaveBeenCalledWith(
      'AutoAuction',
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(3999);
    await flushPromises();
    expect(window.bidkingDesktop.runAutoOperationCommand).not.toHaveBeenCalledWith(
      'SetExpectedPrice',
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(window.bidkingDesktop.runAutoOperationCommand).toHaveBeenNthCalledWith(
      1,
      'SetExpectedPrice',
      { price: 100000 },
    );
    expect(window.bidkingDesktop.runAutoOperationCommand).toHaveBeenNthCalledWith(
      2,
      'AutoAuction',
      { roomId: 101, useExpectedPrice: true },
    );

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('lets disable cancel the initial debounce before SetExpectedPrice and AutoAuction fire', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 40000;
    elsaAutoBidKnownQualityKeys.value = [];

    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'CancelAutoAuction') {
        return Promise.resolve({ ok: true, value: { cancelRequested: false, running: false }, response: {} });
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();

    expect(result.isBusy.value).toBe(false);
    await result.disable();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();

    const commandNames = window.bidkingDesktop.runAutoOperationCommand.mock.calls.map(([name]) => name);
    expect(commandNames).not.toContain('SetExpectedPrice');
    expect(commandNames).not.toContain('AutoAuction');
    expect(result.isEnabled.value).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('debounces consecutive price changes and only syncs the last SetExpectedPrice value', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    const autoAuctionPromise = new Promise(() => {});
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
      }
      if (name === 'AutoAuction') return autoAuctionPromise;
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();

    elsaExpectedPrice.value = 60000;
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    elsaExpectedPrice.value = 70000;
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3999);
    await flushPromises();

    const setExpectedCallsBeforeFire = window.bidkingDesktop.runAutoOperationCommand.mock.calls
      .filter(([name]) => name === 'SetExpectedPrice');
    expect(setExpectedCallsBeforeFire).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    const setExpectedCalls = window.bidkingDesktop.runAutoOperationCommand.mock.calls
      .filter(([name]) => name === 'SetExpectedPrice');
    expect(setExpectedCalls).toHaveLength(1);
    expect(setExpectedCalls[0]).toEqual(['SetExpectedPrice', { price: 140000 }]);
    expect(window.bidkingDesktop.writeDataFile).toHaveBeenLastCalledWith('Price', '140000');

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('stays disabled when the initial SetExpectedPrice sync fails', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'SetExpectedPrice') {
        return Promise.reject(new Error('pipe down'));
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();

    expect(result.isEnabled.value).toBe(false);
    expect(window.bidkingDesktop.runAutoOperationCommand).not.toHaveBeenCalledWith(
      'AutoAuction',
      expect.anything(),
    );
    expect(result.log.value.some(
      e => e.level === 'error' && e.message.includes('初始化自动竞拍价格同步失败')
    )).toBe(true);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('logs a warn entry when a live SetExpectedPrice resync fails after AutoAuction has started', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    let setExpectedCount = 0;
    const autoAuctionPromise = new Promise(() => {});
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        setExpectedCount += 1;
        if (setExpectedCount === 1) {
          return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
        }
        return Promise.reject(new Error('bridge lost'));
      }
      if (name === 'AutoAuction') return autoAuctionPromise;
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();

    elsaExpectedPrice.value = 65000;
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();

    expect(result.isEnabled.value).toBe(true);
    expect(result.log.value.some(
      e => e.level === 'warn' && e.message.includes('同步自动竞拍价格失败')
    )).toBe(true);

    wrapper.unmount();
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run the composable test file and confirm RED**

Run:

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected:

- New tests fail because current code starts `AutoAuction` immediately
- Current code never calls `SetExpectedPrice`
- Current code does not keep `disable()` usable during the initial wait

- [ ] **Step 3: Commit the RED test-only change**

```bash
git add src/elsa/useElsaAutoOperation.test.js
git commit -m "test(elsa): cover debounced auto auction price sync"
```

---

### Task 2: App-Side Implementation

**Files:**
- Modify: `src/elsa/useElsaAutoOperation.js`
- Verify: `src/elsa/useElsaAutoOperation.test.js`

**Interfaces:**
- Produces: `scheduleExpectedPriceSync`, `waitForInitialExpectedPriceSync`, non-blocking `enable()`
- Keeps: existing `writePriceFile`, authcode handling, looping `runScript`

- [ ] **Step 1: Add the new session/debounce state**

At the top of `useElsaAutoOperation()`, directly after `let stopPriceWatcher = null;`, insert:

```js
  let pendingExpectedPriceTimer = null;
  let pendingExpectedPriceValue = 0;
  let initialExpectedPriceSync = null;
  let resolveInitialExpectedPriceSync = null;
  let rejectInitialExpectedPriceSync = null;
  let hasSettledInitialExpectedPriceSync = false;
```

- [ ] **Step 2: Add the debounce and initial-sync helpers**

Insert these helpers below `writePriceFile(price)` and above `showDesktopNotification(title, body)`:

```js
  function clearPendingExpectedPriceTimer() {
    if (pendingExpectedPriceTimer) {
      clearTimeout(pendingExpectedPriceTimer);
      pendingExpectedPriceTimer = null;
    }
  }

  function resetInitialExpectedPriceSync() {
    initialExpectedPriceSync = null;
    resolveInitialExpectedPriceSync = null;
    rejectInitialExpectedPriceSync = null;
    hasSettledInitialExpectedPriceSync = false;
  }

  function createInitialExpectedPriceSyncPromise() {
    hasSettledInitialExpectedPriceSync = false;
    initialExpectedPriceSync = new Promise((resolve, reject) => {
      resolveInitialExpectedPriceSync = resolve;
      rejectInitialExpectedPriceSync = reject;
    });
  }

  function settleInitialExpectedPriceSync(kind, value) {
    if (hasSettledInitialExpectedPriceSync) return;
    hasSettledInitialExpectedPriceSync = true;
    if (kind === 'resolve') {
      resolveInitialExpectedPriceSync?.(value);
    } else {
      rejectInitialExpectedPriceSync?.(value);
    }
  }

  async function syncExpectedPrice(price, { isInitial } = {}) {
    await cmd('SetExpectedPrice', { price });
    if (isInitial) {
      settleInitialExpectedPriceSync('resolve');
    }
  }

  function scheduleExpectedPriceSync(price, { isInitial } = {}) {
    pendingExpectedPriceValue = Number(price) || 0;
    clearPendingExpectedPriceTimer();
    pendingExpectedPriceTimer = setTimeout(async () => {
      pendingExpectedPriceTimer = null;
      if (!isEnabled.value) return;
      try {
        await syncExpectedPrice(pendingExpectedPriceValue, { isInitial });
      } catch (error) {
        if (isInitial) {
          settleInitialExpectedPriceSync('reject', error);
        } else {
          addLog(`同步自动竞拍价格失败: ${error?.message || error}`, 'warn');
        }
      }
    }, 4000);
  }

  async function waitForInitialExpectedPriceSync(signal) {
    if (!initialExpectedPriceSync) {
      throw new Error('initial expected price sync not initialized');
    }
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    let abortHandler = null;
    const abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abortHandler, { once: true });
    });
    try {
      await Promise.race([initialExpectedPriceSync, abortPromise]);
    } finally {
      if (abortHandler) {
        signal?.removeEventListener('abort', abortHandler);
      }
    }
  }
```

- [ ] **Step 3: Update `stopAutomation()` to cancel pending sync state**

Inside `stopAutomation(options = {})`, immediately after the existing `if (stopPriceWatcher) { stopPriceWatcher(); stopPriceWatcher = null; }` block, insert:

```js
    clearPendingExpectedPriceTimer();
    resetInitialExpectedPriceSync();
```

Leave the existing `scriptAbort.abort()` block in place; it is what makes `disable()` work during the initial wait window.

- [ ] **Step 4: Move the initial wait into `runScript()` and keep `enable()` non-blocking**

Replace the start of `runScript(signal)`:

```js
  async function runScript(signal) {
    while (!signal.aborted) {
      addLog('开始自动竞拍…');
      addLog(`当前估价: ${elsaExpectedPrice.value || '无，将使用底价'}`);
      addLog(`当前自动出价: ${autoBidPrice.value || '无，将使用底价'}`);

      const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
```

With:

```js
  async function runScript(signal) {
    try {
      await waitForInitialExpectedPriceSync(signal);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') {
        return;
      }
      addLog(`初始化自动竞拍价格同步失败: ${error?.message || error}`, 'error');
      await stopAutomation({ requestCancel: false });
      return;
    }

    while (!signal.aborted) {
      addLog('开始自动竞拍…');
      addLog(`当前估价: ${elsaExpectedPrice.value || '无，将使用底价'}`);
      addLog(`当前自动出价: ${autoBidPrice.value || '无，将使用底价'}`);

      const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
```

- [ ] **Step 5: Change `enable()` so the watcher writes the file immediately but only starts `AutoAuction` after the first debounced sync resolves**

Inside `enable()`, replace the current watcher + controller setup block:

```js
      isEnabled.value = true;
      // Write the app-computed bid immediately, then keep syncing on every change.
      stopPriceWatcher = watch(autoBidPrice, writePriceFile, { immediate: true });

      const controller = new AbortController();
      scriptAbort = controller;
      runScript(controller.signal)
        .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
        .finally(() => {
          if (scriptAbort === controller) {
            scriptAbort = null;
          }
          if (isEnabled.value && !controller.signal.aborted) {
            disable();
          }
        });
```

With:

```js
      isEnabled.value = true;
      const controller = new AbortController();
      scriptAbort = controller;
      createInitialExpectedPriceSyncPromise();

      stopPriceWatcher = watch(
        autoBidPrice,
        (price) => {
          writePriceFile(price);
          scheduleExpectedPriceSync(price, { isInitial: !hasSettledInitialExpectedPriceSync });
        },
        { immediate: true },
      );

      runScript(controller.signal)
        .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
        .finally(() => {
          if (scriptAbort === controller) {
            scriptAbort = null;
          }
          if (isEnabled.value && !controller.signal.aborted) {
            disable();
          }
        });
```

- [ ] **Step 6: Run the composable test file and confirm GREEN**

Run:

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected:

- All old tests remain green
- New debounce/gating tests pass

- [ ] **Step 7: Commit the app-side implementation**

```bash
git add src/elsa/useElsaAutoOperation.js src/elsa/useElsaAutoOperation.test.js
git commit -m "feat(elsa): debounce agent price sync before auto auction"
```

---

### Task 3: Native Helper Tests First

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

**Interfaces:**
- Produces:
  - `ShouldRecordAutoAuctionRoundSeen(const std::string& round, const std::string& lastRoundSeen) -> bool`
  - `ShouldAttemptExpectedPriceAutoBid(int resolvedAmount, const std::string& round, const std::string& lastBidRound) -> bool`
  - `ShouldAttemptLegacyAutoBid(int secs, const std::string& round, const std::string& lastBidRound) -> bool`
  - `ResolveAutoAuctionReportedExpectedPrice(int lastExpectedPrice, int notifiedExpectedPrice) -> int`

- [ ] **Step 1: Add the failing native assertions**

Append these assertions near the end of `AggregateOperationSemantics.test.cpp`, before `return 0;`:

```cpp
    assert(ShouldRecordAutoAuctionRoundSeen("第1轮", ""));
    assert(!ShouldRecordAutoAuctionRoundSeen("", ""));
    assert(!ShouldRecordAutoAuctionRoundSeen("第1轮", "第1轮"));

    assert(!ShouldAttemptExpectedPriceAutoBid(11119, "", ""));
    assert(!ShouldAttemptExpectedPriceAutoBid(11119, "第1轮", "第1轮"));
    assert(!ShouldAttemptExpectedPriceAutoBid(0, "第1轮", ""));
    assert(ShouldAttemptExpectedPriceAutoBid(11119, "第1轮", ""));

    assert(!ShouldAttemptLegacyAutoBid(15, "第1轮", ""));
    assert(ShouldAttemptLegacyAutoBid(14, "第1轮", ""));
    assert(!ShouldAttemptLegacyAutoBid(14, "第1轮", "第1轮"));

    assert(ResolveAutoAuctionReportedExpectedPrice(80000, 11119) == 80000);
    assert(ResolveAutoAuctionReportedExpectedPrice(0, 11119) == 11119);
```

- [ ] **Step 2: Run the native semantics test and confirm RED**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_agg_semantics_test && /tmp/bk_agg_semantics_test"
```

Expected:

- Compile fails because the new helpers do not exist yet

- [ ] **Step 3: Add the pure helpers to `AggregateOperationSemantics.h`**

Append these functions after `ShouldAbortAutoAuction`:

```cpp
inline bool ShouldRecordAutoAuctionRoundSeen(
    const std::string& round,
    const std::string& lastRoundSeen
) {
    return !round.empty() && round != lastRoundSeen;
}

inline bool ShouldAttemptExpectedPriceAutoBid(
    int resolvedAmount,
    const std::string& round,
    const std::string& lastBidRound
) {
    return resolvedAmount > 0 && !round.empty() && round != lastBidRound;
}

inline bool ShouldAttemptLegacyAutoBid(
    int secs,
    const std::string& round,
    const std::string& lastBidRound
) {
    return secs < 15 && !round.empty() && round != lastBidRound;
}

inline int ResolveAutoAuctionReportedExpectedPrice(
    int lastExpectedPrice,
    int notifiedExpectedPrice
) {
    return lastExpectedPrice > 0 ? lastExpectedPrice : notifiedExpectedPrice;
}
```

Also add the missing include at the top of `AggregateOperationSemantics.h`:

```cpp
#include <string>
```

- [ ] **Step 4: Run the native semantics test and confirm GREEN**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_agg_semantics_test && /tmp/bk_agg_semantics_test"
```

Expected:

- Process exits `0`

- [ ] **Step 5: Commit the helper/test layer**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "test(agent): lock auto auction bid gate semantics"
```

---

### Task 4: Native AutoAuction Wiring

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Verify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

**Interfaces:**
- Replaces: `g_expectedPrice`, `PriceReaderThreadProc`, `StartPriceReaderThread`, `StopPriceReaderThread`
- Uses: `g_notifiedExpectedPrice`, pure helper functions from Task 3

- [ ] **Step 1: Remove the old file-reader price source and add `g_notifiedExpectedPrice`**

At the top of `MetaOperations.cpp`, replace:

```cpp
static std::atomic<int> g_expectedPrice{0};
static std::atomic<bool> g_autoAuctionRunning{false};
static std::atomic<bool> g_autoAuctionCancelRequested{false};

static HANDLE g_priceReaderThread = NULL;
static HANDLE g_priceReaderStopEvent = NULL;

static DWORD WINAPI PriceReaderThreadProc(LPVOID) {
    wchar_t userProfile[MAX_PATH] = {};
    GetEnvironmentVariableW(L"USERPROFILE", userProfile, MAX_PATH);
    wchar_t pricePath[MAX_PATH];
    swprintf_s(pricePath, MAX_PATH, L"%s\\Documents\\BidKing\\Price", userProfile);
    while (WaitForSingleObject(g_priceReaderStopEvent, 2000) == WAIT_TIMEOUT) {
        FILE* f = nullptr;
        if (_wfopen_s(&f, pricePath, L"r") == 0 && f) {
            char buf[32] = {};
            if (fgets(buf, sizeof(buf), f)) {
                int price = atoi(buf);
                if (price > 0) g_expectedPrice.store(price);
            }
            fclose(f);
        }
    }
    return 0;
}

static void StartPriceReaderThread() {
    if (g_priceReaderStopEvent) {
        SetEvent(g_priceReaderStopEvent);
        if (g_priceReaderThread) {
            WaitForSingleObject(g_priceReaderThread, 3000);
            CloseHandle(g_priceReaderThread);
            g_priceReaderThread = NULL;
        }
        CloseHandle(g_priceReaderStopEvent);
        g_priceReaderStopEvent = NULL;
    }
    g_priceReaderStopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!g_priceReaderStopEvent) return;
    g_priceReaderThread = CreateThread(NULL, 0, PriceReaderThreadProc, NULL, 0, NULL);
    if (!g_priceReaderThread) {
        CloseHandle(g_priceReaderStopEvent);
        g_priceReaderStopEvent = NULL;
    }
}

static void StopPriceReaderThread() {
    if (g_priceReaderStopEvent) SetEvent(g_priceReaderStopEvent);
    if (g_priceReaderThread) {
        WaitForSingleObject(g_priceReaderThread, 5000);
        CloseHandle(g_priceReaderThread);
        g_priceReaderThread = NULL;
    }
    if (g_priceReaderStopEvent) {
        CloseHandle(g_priceReaderStopEvent);
        g_priceReaderStopEvent = NULL;
    }
}
```

With:

```cpp
static std::atomic<int> g_notifiedExpectedPrice{0};
static std::atomic<bool> g_autoAuctionRunning{false};
static std::atomic<bool> g_autoAuctionCancelRequested{false};
```

- [ ] **Step 2: Point `CmdSetExpectedPrice` at the new state**

Inside `CmdSetExpectedPrice`, replace:

```cpp
    g_expectedPrice.store(price);
```

With:

```cpp
    g_notifiedExpectedPrice.store(price);
```

- [ ] **Step 3: Replace the reported-price fallback sites**

In `sendAuthCodeRequired`, replace:

```cpp
        const int reportedExpectedPrice = lastExpectedPrice > 0 ? lastExpectedPrice : g_expectedPrice.load();
```

With:

```cpp
        const int reportedExpectedPrice = ResolveAutoAuctionReportedExpectedPrice(
            lastExpectedPrice,
            g_notifiedExpectedPrice.load()
        );
```

In the early-ended branch inside Step 5, replace:

```cpp
                    "{\"result\":\"auction_ended\",\"rounds\":0,\"expectedPrice\":%d}",
                    g_expectedPrice.load());
```

With:

```cpp
                    "{\"result\":\"auction_ended\",\"rounds\":0,\"expectedPrice\":%d}",
                    ResolveAutoAuctionReportedExpectedPrice(lastExpectedPrice, g_notifiedExpectedPrice.load()));
```

- [ ] **Step 4: Remove the price-reader startup/shutdown from `CmdAutoAuction`**

Delete this block near the top of `CmdAutoAuction`:

```cpp
    StartPriceReaderThread();
    struct PriceReaderGuard { ~PriceReaderGuard() { StopPriceReaderThread(); } } _priceGuard;
```

- [ ] **Step 5: Rewire the bid loop guards without touching the opponent-cap block**

Inside the bid loop, replace:

```cpp
        if (!round.empty() && round != lastRoundSeen) {
            lastRoundSeen = round;
            roundsEncountered++;
        }

        if (secs < 15 && !round.empty() && round != lastBidRound) {
            static const int FLOOR_PRICE = 11119;
            int currentPrice = g_expectedPrice.load();
            if (useExpectedPrice && currentPrice <= 0) currentPrice = FLOOR_PRICE;
            int amount = useExpectedPrice
                ? currentPrice
                : bidAmount;
            const int originalBid = amount;
            lastExpectedPrice = useExpectedPrice ? currentPrice : 0;

            if (amount == 0) continue; // skip — price not set yet
```

With:

```cpp
        if (ShouldRecordAutoAuctionRoundSeen(round, lastRoundSeen)) {
            lastRoundSeen = round;
            roundsEncountered++;
        }

        int amount = 0;
        int currentPrice = 0;
        if (useExpectedPrice) {
            static const int FLOOR_PRICE = 11119;
            currentPrice = g_notifiedExpectedPrice.load();
            if (currentPrice <= 0) currentPrice = FLOOR_PRICE;
            amount = currentPrice;
            lastExpectedPrice = currentPrice;
            if (!ShouldAttemptExpectedPriceAutoBid(amount, round, lastBidRound)) {
                continue;
            }
        } else {
            if (!ShouldAttemptLegacyAutoBid(secs, round, lastBidRound)) {
                continue;
            }
            amount = bidAmount;
        }

        if (amount == 0) {
            continue;
        }

        const int originalBid = amount;
```

Do **not** edit the existing opponent-cap block that starts with:

```cpp
            if (useExpectedPrice && roundsEncountered >= 2 && roundsEncountered <= 5) {
```

Leave that whole block intact. The only change is that `originalBid` now comes from the new `amount` source above it.

- [ ] **Step 6: Run native tests and the DLL build**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_agg_semantics_test && /tmp/bk_agg_semantics_test && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"
```

Expected:

- Native helper test exits `0`
- Final line: `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`

- [ ] **Step 7: Commit the native wiring**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git commit -m "feat(agent): gate auto auction on debounced expected price sync"
```

---

### Task 5: Full Verification Sweep

**Files:**
- Verify only: `src/elsa/useElsaAutoOperation.js`, `src/elsa/useElsaAutoOperation.test.js`, `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`, `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.*`

- [ ] **Step 1: Run the focused JS and native verification commands**

Run:

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
wsl bash -lc "cd /mnt/a/BidKing && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_agg_semantics_test && /tmp/bk_agg_semantics_test"
wsl bash -lc "cd /mnt/a/BidKing && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"
```

Expected:

- Vitest: all tests pass
- Native helper binary exits `0`
- DLL rebuild finishes with `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`

- [ ] **Step 2: Run a broader Elsa regression set**

Run:

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js src/elsa/elsaEstimateState.test.js src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected:

- All three files pass; no regressions in Elsa estimate state or estimator panel

- [ ] **Step 3: Inspect the final diff before handoff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git status --short
```

Expected:

- `git diff --stat` only shows the app-side JS/test files, native C++/test files, and rebuilt DLL from this feature
- `git status --short` is empty

- [ ] **Step 4: Final handoff commit (only if you made any follow-up fixups during verification)**

```bash
git add src/elsa/useElsaAutoOperation.js \
        src/elsa/useElsaAutoOperation.test.js \
        tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git commit -m "fix: finalize debounced auto auction price sync"
```
