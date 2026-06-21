# Agent Collection Price Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the topbar `BKPayload64` collection-price scheduler with an Inject page collection-price scanner powered by the AutoOperation Agent.

**Architecture:** AutoOperation Agent exposes only small IL2CPP commands for collection cid listing and single-item trade info. A Node/Electron singleton `CollectionPriceScanController` owns scan state, timers, cancellation, Agent calls, and history writes. Inject UI is a control/status panel that survives navigation by reading controller state on mount.

**Tech Stack:** Vue 3, Electron IPC/preload, Node CommonJS services, Vitest, MinGW C++ build for `BKAutoOpAgent.dll`.

---

## File Structure

- Modify `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
  - Add Agent commands `GetCollectionItemCids` and direct `GetItemTradeInfo`.
  - Reuse existing trade list parsing helper used by delayed price query.
- Modify `tools/inject/AutoOperation/BKAutoOpAgent/TradeListSummary.h`
  - Keep the pure JSON summary helper as the shared output formatter.
- Modify `docs/AUTO_OPERATION_COMMANDS.md`
  - Document the two new Agent commands and the new collection scan flow.
- Create `lib/trade-info-history-recorder.js`
  - Validate Agent trade info results and write `Cids.json`, CSV/latest, and ladder JSONL through existing stores.
- Create `lib/trade-info-history-recorder.test.mjs`
  - Unit-test file outputs and invalid payload handling.
- Create `electron/services/collection-price-scan-controller.js`
  - Own task state, timers, config, start/stop/status, Agent calls, and history recording.
- Create `electron/services/collection-price-scan-controller.test.mjs`
  - Unit-test scan loop, stop behavior, remount-safe status, config validation, and failure counting.
- Modify `electron/main.js`
  - Remove topbar schedule IPC usage from the UI path.
  - Register collection scan IPC handlers and status event fanout.
- Modify `electron/preload.js`
  - Expose collection scan APIs to Inject UI.
  - Stop exposing schedule APIs used only by the topbar switch.
- Modify `src/shared/TopBar.vue`
  - Remove the injection schedule switch from topbar.
- Modify `src/shared/TopBar.test.js`
  - Replace schedule-switch tests with assertions that no topbar schedule control is rendered.
- Modify `src/inject/App.vue`
  - Add the collection-price scan panel.
- Modify `src/inject/App.test.js`
  - Test panel start/stop/status/config/remount behavior.
- Modify `src/shared/messages.js`
  - Add zh/en Inject panel labels.

---

## Task 1: Add Direct Agent Commands

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`
- Test/Build: `tools/inject/AutoOperation/BKAutoOpAgent/TradeListSummary.test.cpp`

- [ ] **Step 1: Write the expected command docs before code**

Add this section to `docs/AUTO_OPERATION_COMMANDS.md` after delayed price query commands:

### GetCollectionItemCids

Returns the current user's collected item cids from `PlayerManager.GetAllCollectionItems()`.

Request:

```json
{
  "id": "12",
  "cmd": "GetCollectionItemCids",
  "args": {}
}
```

Success result:

```json
{
  "cids": [1013007, 1032006],
  "count": 2
}
```

### GetItemTradeInfo

Queries one item's exchange trade tiers through `PlayerManager.GetItemTradeInfo(itemCid)`.

Request:

```json
{
  "id": "13",
  "cmd": "GetItemTradeInfo",
  "args": {
    "itemCid": 1032006
  }
}
```

Success result:

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

- [ ] **Step 2: Run the existing pure C++ test**

Run:

```bash
g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/TradeListSummary.test.cpp -o /tmp/bk_trade_summary_test && /tmp/bk_trade_summary_test
```

Expected: PASS. This confirms the shared trade-list summary JSON helper still works before command wiring changes.

- [ ] **Step 3: Add `CmdGetItemTradeInfo`**

In `BKAutoOpAgent.cpp`, extract the body of `ExecutePriceQuery` so the direct command and delayed task share it:

```cpp
static bool QueryItemTradeInfoJson(int itemCid, char* result, int resultSize, char* error, int errorSize) {
    if (!g_il2cppReady) {
        snprintf(error, errorSize, "il2cpp not ready");
        return false;
    }
    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) {
        snprintf(error, errorSize, "PlayerManager singleton null");
        return false;
    }
    const Il2CppMethod* getTradeInfo = g_class_get_method_from_name(pmClass, "GetItemTradeInfo", 1);
    if (!getTradeInfo) {
        snprintf(error, errorSize, "GetItemTradeInfo not found");
        return false;
    }
    int32_t argItemCid = (int32_t)itemCid;
    void* args[] = { &argItemCid };
    Il2CppObject* tradeInfoTask = (Il2CppObject*)SafeInvoke(getTradeInfo, pmInst, args);
    if (!tradeInfoTask) {
        snprintf(error, errorSize, "GetItemTradeInfo returned null");
        return false;
    }
    Il2CppObject* tradeInfo = AwaitTaskResultObject(tradeInfoTask, 30000, "GetItemTradeInfo", error, errorSize);
    if (!tradeInfo) return false;
    TradeListSummary summary = {};
    if (!BuildIl2CppTradeListSummaryJson(itemCid, tradeInfo, 32, result, resultSize, &summary)) {
        snprintf(error, errorSize, "failed to build trade list summary");
        return false;
    }
    return true;
}

static void CmdGetItemTradeInfo(AgentConn* c, const char* id, const char* json) {
    int itemCid = JsonGetInt(json, "itemCid");
    if (itemCid == INT_MIN) itemCid = JsonGetInt(json, "cid");
    if (itemCid <= 0) {
        SendResponse(c, id, false, "invalid itemCid");
        return;
    }
    char result[4096] = {};
    char error[256] = {};
    if (!QueryItemTradeInfoJson(itemCid, result, sizeof(result), error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }
    SendResponse(c, id, true, result);
}
```

Then change `ExecutePriceQuery` to call `QueryItemTradeInfoJson`.

- [ ] **Step 4: Add `CmdGetCollectionItemCids`**

In `BKAutoOpAgent.cpp`, add:

```cpp
static void CmdGetCollectionItemCids(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }
    const Il2CppMethod* getAllItems = g_class_get_method_from_name(pmClass, "GetAllCollectionItems", 0);
    if (!getAllItems) { SendResponse(c, id, false, "GetAllCollectionItems not found"); return; }
    Il2CppObject* itemList = (Il2CppObject*)SafeInvoke(getAllItems, pmInst, nullptr);
    if (!itemList) { SendResponse(c, id, false, "GetAllCollectionItems returned null"); return; }
    int count = ReadListCount(itemList);
    int cids[2000] = {};
    int uniqueCount = 0;
    for (int i = 0; i < count && uniqueCount < 2000; i++) {
        Il2CppObject* item = ReadListItem(itemList, i);
        if (!item) continue;
        int cid = UNBOX_INT32(item);
        if (cid <= 0) continue;
        bool seen = false;
        for (int j = 0; j < uniqueCount; j++) {
            if (cids[j] == cid) { seen = true; break; }
        }
        if (!seen) cids[uniqueCount++] = cid;
    }
    char result[16384] = {};
    int pos = snprintf(result, sizeof(result), "{\"cids\":[");
    for (int i = 0; i < uniqueCount && pos < (int)sizeof(result) - 32; i++) {
        pos += snprintf(result + pos, sizeof(result) - pos, "%s%d", i ? "," : "", cids[i]);
    }
    snprintf(result + pos, sizeof(result) - pos, "],\"count\":%d}", uniqueCount);
    SendResponse(c, id, true, result);
}
```

- [ ] **Step 5: Register the commands**

Add the entries near the existing command table:

```cpp
{ "GetCollectionItemCids", CmdGetCollectionItemCids },
{ "GetItemTradeInfo",     CmdGetItemTradeInfo     },
```

- [ ] **Step 6: Build and commit**

Run:

```bash
g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/TradeListSummary.test.cpp -o /tmp/bk_trade_summary_test && /tmp/bk_trade_summary_test
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected: both commands exit `0`.

Commit:

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll docs/AUTO_OPERATION_COMMANDS.md
git commit -m "feat: add agent trade info commands"
```

---

## Task 2: Add Trade Info History Recorder

**Files:**
- Create: `lib/trade-info-history-recorder.js`
- Create: `lib/trade-info-history-recorder.test.mjs`

- [ ] **Step 1: Write failing recorder tests**

Create `lib/trade-info-history-recorder.test.mjs`:

```js
/* @vitest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PriceHistoryStore } from './bidking-price-history-store.js';
import { MarketLadderStore } from './bidking-market-ladder-store.js';
import {
  recordCollectionCids,
  recordTradeInfoSnapshot,
} from './trade-info-history-recorder.js';

describe('trade-info-history-recorder', () => {
  it('writes Cids.json with unique positive cids', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      const result = recordCollectionCids([1032006, 1032006, 0, 'bad', 1013007], { rootDir });
      expect(result).toEqual({ written: true, itemCids: [1032006, 1013007] });
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'Cids.json'), 'utf8'))).toEqual([1032006, 1013007]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('records min-price CSV, latest index, and ladder JSONL', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      const priceHistoryStore = new PriceHistoryStore({ rootDir });
      const marketLadderStore = new MarketLadderStore({ rootDir });
      const result = recordTradeInfoSnapshot({
        itemCid: 1032006,
        tiers: [
          { price: 6400, count: 4 },
          { price: 6200, count: 3 },
        ],
      }, {
        observedAt: '2026-06-02T12:30:15.123Z',
        priceHistoryStore,
        marketLadderStore,
      });
      expect(result).toMatchObject({
        ok: true,
        itemCid: 1032006,
        minPrice: 6200,
        tierCount: 2,
        totalCount: 7,
      });
      expect(fs.readFileSync(path.join(rootDir, 'items', '1032006.csv'), 'utf8')).toContain('2026-06-02T12:30:15.123Z,6200');
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'latest.json'), 'utf8'))['1032006'].minPrice).toBe(6200);
      const ladderLine = fs.readFileSync(path.join(rootDir, 'ladders', '1032006.jsonl'), 'utf8').trim();
      expect(JSON.parse(ladderLine)).toEqual({
        observedAt: '2026-06-02T12:30:15.123Z',
        itemCid: 1032006,
        tiers: [
          { price: 6200, count: 3 },
          { price: 6400, count: 4 },
        ],
      });
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects trade info with no valid tiers', () => {
    const result = recordTradeInfoSnapshot({
      itemCid: 1032006,
      tiers: [{ price: 0, count: 1 }],
    }, { observedAt: '2026-06-02T12:30:15.123Z' });
    expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- lib/trade-info-history-recorder.test.mjs
```

Expected: FAIL with module resolution error for `trade-info-history-recorder.js`.

- [ ] **Step 3: Implement the recorder**

Create `lib/trade-info-history-recorder.js`:

```js
const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');
const { PriceHistoryStore } = require('./bidking-price-history-store.js');
const { MarketLadderStore } = require('./bidking-market-ladder-store.js');

const PRICE_HISTORY_DIR_NAME = 'BKPriceHistory';

function getDefaultRootDir() {
  return path.join(getDocumentsDir(), PRICE_HISTORY_DIR_NAME);
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers)) return [];
  const normalized = [];
  for (const tier of tiers) {
    const price = normalizePositiveInteger(tier?.price);
    const count = normalizePositiveInteger(tier?.count);
    if (price === null || count === null) continue;
    normalized.push({ price, count });
  }
  return normalized.sort((left, right) => left.price - right.price);
}

function recordCollectionCids(cids, deps = {}) {
  const rootDir = deps.rootDir || getDefaultRootDir();
  const seen = new Set();
  const itemCids = [];
  for (const value of Array.isArray(cids) ? cids : []) {
    const cid = normalizePositiveInteger(value);
    if (cid === null || seen.has(cid)) continue;
    seen.add(cid);
    itemCids.push(cid);
  }
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'Cids.json'), `${JSON.stringify(itemCids)}\n`, 'utf8');
  return { written: true, itemCids };
}

function recordTradeInfoSnapshot(snapshot, deps = {}) {
  const itemCid = normalizePositiveInteger(snapshot?.itemCid ?? snapshot?.cid);
  const tiers = normalizeTiers(snapshot?.tiers);
  const observedAt = deps.observedAt || new Date().toISOString();
  if (itemCid === null || tiers.length === 0) {
    return { ok: false, error: 'invalid trade info snapshot' };
  }
  const minPrice = tiers[0].price;
  const totalCount = tiers.reduce((sum, tier) => sum + tier.count, 0);
  const record = { observedAt, itemCid, tiers };
  const priceHistoryStore = deps.priceHistoryStore || new PriceHistoryStore({ rootDir: deps.rootDir });
  const marketLadderStore = deps.marketLadderStore || new MarketLadderStore({ rootDir: deps.rootDir });
  const priceResult = priceHistoryStore.recordSnapshot({ observedAt, itemCid, minPrice });
  const ladderResult = marketLadderStore.recordLadder(record);
  return {
    ok: priceResult.reason !== 'invalid' && ladderResult.reason !== 'invalid',
    itemCid,
    observedAt: new Date(observedAt).toISOString(),
    minPrice,
    tierCount: tiers.length,
    totalCount,
    priceHistory: priceResult,
    ladder: ladderResult,
  };
}

module.exports = {
  recordCollectionCids,
  recordTradeInfoSnapshot,
  normalizeTiers,
};
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- lib/trade-info-history-recorder.test.mjs
```

Expected: 3 tests pass.

Commit:

```bash
git add lib/trade-info-history-recorder.js lib/trade-info-history-recorder.test.mjs
git commit -m "feat: record agent trade info history"
```

---

## Task 3: Add Collection Price Scan Controller

**Files:**
- Create: `electron/services/collection-price-scan-controller.js`
- Create: `electron/services/collection-price-scan-controller.test.mjs`

- [ ] **Step 1: Write failing controller tests**

Create `electron/services/collection-price-scan-controller.test.mjs`:

```js
/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollectionPriceScanController } from './collection-price-scan-controller.js';

let controller;
let runAutoOperationCommand;
let startAutoOperationAgent;
let recordCollectionCids;
let recordTradeInfoSnapshot;

beforeEach(() => {
  vi.useFakeTimers();
  runAutoOperationCommand = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: { cids: [1032006, 1013007], count: 2 } })
    .mockResolvedValueOnce({ ok: true, value: { itemCid: 1032006, tiers: [{ price: 6200, count: 3 }] } })
    .mockResolvedValueOnce({ ok: true, value: { itemCid: 1013007, tiers: [{ price: 100, count: 1 }] } });
  startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
  recordCollectionCids = vi.fn().mockReturnValue({ written: true, itemCids: [1032006, 1013007] });
  recordTradeInfoSnapshot = vi.fn((snapshot) => ({ ok: true, itemCid: snapshot.itemCid, minPrice: snapshot.tiers[0].price, tierCount: 1, totalCount: snapshot.tiers[0].count }));
  controller = createCollectionPriceScanController({
    startAutoOperationAgent,
    runAutoOperationCommand,
    recordCollectionCids,
    recordTradeInfoSnapshot,
    random: () => 0,
  });
});

afterEach(() => {
  controller?.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('collection price scan controller', () => {
  it('starts by loading cids and querying each item with configured delay', async () => {
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {});
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1032006 });
    expect(controller.getState()).toMatchObject({ state: 'waiting_item', completedCount: 1, writtenCount: 1 });

    await vi.advanceTimersByTimeAsync(5000);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState()).toMatchObject({ state: 'waiting_cycle', completedCount: 2, writtenCount: 2 });
  });

  it('stops during wait and prevents the next item query', async () => {
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    expect(controller.getState().state).toBe('stopped');
  });

  it('returns current state for remounted UI', async () => {
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const state = controller.getState();
    expect(state).toMatchObject({ enabled: true, state: 'waiting_item', currentCid: 1032006 });
  });

  it('continues after a single item failure', async () => {
    runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { cids: [1032006, 1013007], count: 2 } })
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce({ ok: true, value: { itemCid: 1013007, tiers: [{ price: 100, count: 1 }] } });
    controller = createCollectionPriceScanController({
      startAutoOperationAgent,
      runAutoOperationCommand,
      recordCollectionCids,
      recordTradeInfoSnapshot,
      random: () => 0,
    });
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 1, itemJitterSeconds: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState()).toMatchObject({ failedCount: 1, completedCount: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getState()).toMatchObject({ writtenCount: 1, completedCount: 2 });
  });
});
```

- [ ] **Step 2: Verify controller tests fail**

Run:

```bash
npm test -- electron/services/collection-price-scan-controller.test.mjs
```

Expected: FAIL with module resolution error for `collection-price-scan-controller.js`.

- [ ] **Step 3: Implement the controller**

Create `electron/services/collection-price-scan-controller.js` with:

```js
const DEFAULT_CONFIG = {
  scanIntervalMinutes: 60,
  itemDelaySeconds: 5,
  itemJitterSeconds: 5,
};

function normalizeInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

function normalizeConfig(config = {}) {
  return {
    scanIntervalMinutes: normalizeInteger(config.scanIntervalMinutes, 1, 1440, DEFAULT_CONFIG.scanIntervalMinutes),
    itemDelaySeconds: normalizeInteger(config.itemDelaySeconds, 0, 3600, DEFAULT_CONFIG.itemDelaySeconds),
    itemJitterSeconds: normalizeInteger(config.itemJitterSeconds, 0, 3600, DEFAULT_CONFIG.itemJitterSeconds),
  };
}

function createCollectionPriceScanController(deps = {}) {
  let config = normalizeConfig(deps.initialConfig);
  let enabled = false;
  let state = 'idle';
  let timer = null;
  let stopRequested = false;
  let current = emptyProgress();
  const listeners = new Set();

  function emptyProgress() {
    return {
      itemCount: 0,
      currentIndex: 0,
      currentCid: null,
      completedCount: 0,
      writtenCount: 0,
      failedCount: 0,
      nextItemAt: null,
      nextRunAt: null,
      lastResult: null,
      lastError: '',
    };
  }

  function publish() {
    const snapshot = getState();
    for (const listener of listeners) listener(snapshot);
  }

  function schedule(ms, nextState, key, fn) {
    clearScheduled();
    state = nextState;
    current[key] = Date.now() + ms;
    publish();
    timer = setTimeout(fn, ms);
  }

  function clearScheduled() {
    if (timer) clearTimeout(timer);
    timer = null;
    current.nextItemAt = null;
    current.nextRunAt = null;
  }

  async function runCycle() {
    if (!enabled || stopRequested) return finishStopped();
    clearScheduled();
    state = 'running';
    current = emptyProgress();
    publish();
    try {
      await deps.startAutoOperationAgent();
      const cidResponse = await deps.runAutoOperationCommand('GetCollectionItemCids', {});
      const cids = Array.isArray(cidResponse?.value?.cids) ? cidResponse.value.cids : [];
      deps.recordCollectionCids(cids);
      current.itemCount = cids.length;
      for (let index = 0; index < cids.length; index++) {
        if (!enabled || stopRequested) return finishStopped();
        current.currentIndex = index + 1;
        current.currentCid = cids[index];
        state = 'running';
        publish();
        try {
          const tradeResponse = await deps.runAutoOperationCommand('GetItemTradeInfo', { itemCid: cids[index] });
          const written = deps.recordTradeInfoSnapshot(tradeResponse.value);
          current.lastResult = written;
          if (written?.ok) current.writtenCount++;
          else current.failedCount++;
        } catch (error) {
          current.failedCount++;
          current.lastError = error?.message || String(error);
        }
        current.completedCount++;
        publish();
        if (index + 1 < cids.length) {
          await waitForItemDelay();
        }
      }
      if (!enabled || stopRequested) return finishStopped();
      const cycleDelayMs = config.scanIntervalMinutes * 60 * 1000;
      schedule(cycleDelayMs, 'waiting_cycle', 'nextRunAt', runCycle);
    } catch (error) {
      state = 'failed';
      current.lastError = error?.message || String(error);
      enabled = false;
      publish();
    }
  }

  function waitForItemDelay() {
    const jitterMs = Math.floor((deps.random ? deps.random() : Math.random()) * (config.itemJitterSeconds * 1000 + 1));
    const delayMs = config.itemDelaySeconds * 1000 + jitterMs;
    return new Promise((resolve) => schedule(delayMs, 'waiting_item', 'nextItemAt', resolve));
  }

  function finishStopped() {
    clearScheduled();
    enabled = false;
    stopRequested = false;
    state = 'stopped';
    publish();
  }

  async function start(nextConfig = {}) {
    config = normalizeConfig({ ...config, ...nextConfig });
    if (enabled && ['running', 'waiting_item', 'waiting_cycle'].includes(state)) return getState();
    enabled = true;
    stopRequested = false;
    runCycle();
    publish();
    return getState();
  }

  function stop() {
    stopRequested = true;
    enabled = false;
    clearScheduled();
    if (state === 'waiting_item' || state === 'waiting_cycle' || state === 'idle') {
      finishStopped();
    } else {
      state = 'stopping';
      publish();
    }
    return getState();
  }

  function updateConfig(nextConfig = {}) {
    config = normalizeConfig({ ...config, ...nextConfig });
    publish();
    return getState();
  }

  function getState() {
    return { enabled, state, config, ...current };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { start, stop, updateConfig, getState, subscribe };
}

module.exports = {
  createCollectionPriceScanController,
  normalizeConfig,
};
```

- [ ] **Step 4: Run controller tests and commit**

Run:

```bash
npm test -- electron/services/collection-price-scan-controller.test.mjs
```

Expected: 4 tests pass.

Commit:

```bash
git add electron/services/collection-price-scan-controller.js electron/services/collection-price-scan-controller.test.mjs
git commit -m "feat: add collection price scan controller"
```

---

## Task 4: Wire Electron IPC and Remove Topbar Schedule Path

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `electron/services/inject-service.js`
- Modify: `electron/services/inject-service.test.mjs`
- Modify: `src/shared/TopBar.vue`
- Modify: `src/shared/TopBar.test.js`

- [ ] **Step 1: Write failing IPC/service tests**

Append to `electron/services/inject-service.test.mjs`:

```js
describe('collection price scan desktop helpers', () => {
  it('passes collection scan start/stop/status to the controller', async () => {
    const controller = {
      start: vi.fn().mockResolvedValue({ state: 'running' }),
      stop: vi.fn().mockReturnValue({ state: 'stopped' }),
      getState: vi.fn().mockReturnValue({ state: 'running' }),
      updateConfig: vi.fn().mockReturnValue({ config: { scanIntervalMinutes: 30 } }),
    };

    expect(await service.startCollectionPriceScan({ scanIntervalMinutes: 30 }, { controller })).toEqual({ state: 'running' });
    expect(service.stopCollectionPriceScan({ controller })).toEqual({ state: 'stopped' });
    expect(service.getCollectionPriceScanStatus({ controller })).toEqual({ state: 'running' });
    expect(service.updateCollectionPriceScanConfig({ scanIntervalMinutes: 30 }, { controller })).toEqual({ config: { scanIntervalMinutes: 30 } });
  });
});
```

Modify `src/shared/TopBar.test.js` by replacing schedule-switch tests with:

```js
it('does not render the old inject schedule switch in desktop mode', async () => {
  window.bidkingDesktop = {
    isDesktop: true,
    setScheduleEnabled: vi.fn().mockResolvedValue(undefined),
    getScheduleState: vi.fn().mockResolvedValue({ enabled: true }),
    onScheduleState: vi.fn().mockReturnValue(() => {}),
  };
  const w = mountBar();
  await flushPromises();
  await nextTick();

  expect(w.find('.inject-schedule-toggle').exists()).toBe(false);
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npm test -- electron/services/inject-service.test.mjs src/shared/TopBar.test.js
```

Expected: FAIL because service helper exports do not exist and TopBar still renders schedule switch.

- [ ] **Step 3: Add service wrapper functions**

In `electron/services/inject-service.js`, add:

```js
function getController(deps = {}) {
    if (!deps.controller) throw new Error('Collection price scan controller is unavailable');
    return deps.controller;
}

async function startCollectionPriceScan(config = {}, deps = {}) {
    return getController(deps).start(config);
}

function stopCollectionPriceScan(deps = {}) {
    return getController(deps).stop();
}

function getCollectionPriceScanStatus(deps = {}) {
    return getController(deps).getState();
}

function updateCollectionPriceScanConfig(config = {}, deps = {}) {
    return getController(deps).updateConfig(config);
}
```

Export those functions from `module.exports`.

- [ ] **Step 4: Wire main/preload IPC**

In `electron/main.js`, instantiate the controller after service imports:

```js
const { createCollectionPriceScanController } = require('./services/collection-price-scan-controller');
const {
    recordCollectionCids,
    recordTradeInfoSnapshot,
} = require('../lib/trade-info-history-recorder');
```

After `serverUrl` globals are initialized, create:

```js
const collectionPriceScanController = createCollectionPriceScanController({
    startAutoOperationAgent,
    runAutoOperationCommand,
    recordCollectionCids,
    recordTradeInfoSnapshot,
});

collectionPriceScanController.subscribe((state) => {
    BrowserWindow.getAllWindows().forEach((win) => {
        try { win.webContents.send('inject:collectionPriceScanState', state); } catch (_) {}
    });
});
```

Register IPC handlers in `registerIpc()`:

```js
ipcMain.handle('inject:startCollectionPriceScan', async (_event, config) =>
    collectionPriceScanController.start(config));
ipcMain.handle('inject:stopCollectionPriceScan', () =>
    collectionPriceScanController.stop());
ipcMain.handle('inject:getCollectionPriceScanStatus', () =>
    collectionPriceScanController.getState());
ipcMain.handle('inject:updateCollectionPriceScanConfig', (_event, config) =>
    collectionPriceScanController.updateConfig(config));
```

In `electron/preload.js`, expose:

```js
startCollectionPriceScan: (config) => ipcRenderer.invoke('inject:startCollectionPriceScan', config),
stopCollectionPriceScan: () => ipcRenderer.invoke('inject:stopCollectionPriceScan'),
getCollectionPriceScanStatus: () => ipcRenderer.invoke('inject:getCollectionPriceScanStatus'),
updateCollectionPriceScanConfig: (config) => ipcRenderer.invoke('inject:updateCollectionPriceScanConfig', config),
onCollectionPriceScanState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('inject:collectionPriceScanState', listener);
    return () => ipcRenderer.removeListener('inject:collectionPriceScanState', listener);
},
```

Remove the old `getScheduleState`, `setScheduleEnabled`, `resetInjectionTimer`, and `onScheduleState` exposures after all call sites are removed.

- [ ] **Step 5: Remove TopBar schedule switch**

In `src/shared/TopBar.vue`:

- Remove `useInjectionSchedule` import.
- Remove `const { scheduleEnabled, canSchedule, toggleSchedule } = useInjectionSchedule();`.
- Remove the `<button class="inject-schedule-toggle">...</button>` block.

Keep theme and language buttons unchanged.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- electron/services/inject-service.test.mjs src/shared/TopBar.test.js
```

Expected: both test files pass.

Commit:

```bash
git add electron/main.js electron/preload.js electron/services/inject-service.js electron/services/inject-service.test.mjs src/shared/TopBar.vue src/shared/TopBar.test.js
git commit -m "feat: expose collection price scan controller"
```

---

## Task 5: Add Inject Page Collection Scan Panel

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/inject/inject.css`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: Write failing Inject UI tests**

Append tests to `src/inject/App.test.js`:

```js
it('starts and stops the collection price scan from Inject page', async () => {
  const startCollectionPriceScan = vi.fn().mockResolvedValue({
    enabled: true,
    state: 'running',
    config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 5 },
  });
  const stopCollectionPriceScan = vi.fn().mockResolvedValue({ enabled: false, state: 'stopped' });
  window.bidkingDesktop = {
    isDesktop: true,
    queryCabinetReward: vi.fn(),
    claimCabinetReward: vi.fn(),
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand: vi.fn(),
    startCollectionPriceScan,
    stopCollectionPriceScan,
    getCollectionPriceScanStatus: vi.fn().mockResolvedValue({
      enabled: false,
      state: 'idle',
      config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 5 },
    }),
    onCollectionPriceScanState: vi.fn().mockReturnValue(() => {}),
  };

  const wrapper = await mountApp();
  await wrapper.find('[data-testid="collection-scan-interval"]').setValue('30');
  await wrapper.find('[data-testid="collection-scan-item-delay"]').setValue('7');
  await wrapper.find('[data-testid="collection-scan-item-jitter"]').setValue('3');
  await wrapper.find('[data-testid="collection-scan-start"]').trigger('click');

  expect(startCollectionPriceScan).toHaveBeenCalledWith({
    scanIntervalMinutes: 30,
    itemDelaySeconds: 7,
    itemJitterSeconds: 3,
  });

  await wrapper.find('[data-testid="collection-scan-stop"]').trigger('click');
  expect(stopCollectionPriceScan).toHaveBeenCalledTimes(1);
});

it('restores collection scan status on remount', async () => {
  window.bidkingDesktop = {
    isDesktop: true,
    queryCabinetReward: vi.fn(),
    claimCabinetReward: vi.fn(),
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand: vi.fn(),
    startCollectionPriceScan: vi.fn(),
    stopCollectionPriceScan: vi.fn(),
    getCollectionPriceScanStatus: vi.fn().mockResolvedValue({
      enabled: true,
      state: 'waiting_item',
      itemCount: 128,
      currentIndex: 37,
      currentCid: 1032006,
      completedCount: 37,
      writtenCount: 35,
      failedCount: 2,
      config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 5 },
      lastResult: { itemCid: 1032006, minPrice: 6200, tierCount: 2, totalCount: 7 },
    }),
    onCollectionPriceScanState: vi.fn().mockReturnValue(() => {}),
  };

  const wrapper = await mountApp();
  const panelText = wrapper.find('[data-testid="collection-price-scan-panel"]').text();
  expect(panelText).toContain('waiting_item');
  expect(panelText).toContain('37 / 128');
  expect(panelText).toContain('1032006');
  expect(panelText).toContain('6,200');
});
```

- [ ] **Step 2: Verify Inject tests fail**

Run:

```bash
npm test -- src/inject/App.test.js
```

Expected: FAIL because the panel and desktop APIs are not used yet.

- [ ] **Step 3: Add i18n keys**

In `src/shared/messages.js`, add zh/en keys under `inject`:

```js
collectionScanTitle: '收藏价格采集',
collectionScanDescription: '通过 AutoOperation Agent 周期查询收藏藏品的交易所最低价。',
collectionScanStart: '开始采集',
collectionScanStop: '停止',
collectionScanInterval: '整轮间隔（分钟）',
collectionScanItemDelay: '单项等待（秒）',
collectionScanItemJitter: '随机浮动（秒）',
collectionScanState: '状态',
collectionScanProgress: '进度',
collectionScanCurrentCid: '当前 CID',
collectionScanWritten: '写入',
collectionScanFailed: '失败',
collectionScanLatest: '最近结果',
```

Add matching English values:

```js
collectionScanTitle: 'Collection Price Scan',
collectionScanDescription: 'Periodically query collected item exchange lows through the AutoOperation Agent.',
collectionScanStart: 'Start Scan',
collectionScanStop: 'Stop',
collectionScanInterval: 'Cycle Interval (min)',
collectionScanItemDelay: 'Item Delay (sec)',
collectionScanItemJitter: 'Random Jitter (sec)',
collectionScanState: 'State',
collectionScanProgress: 'Progress',
collectionScanCurrentCid: 'Current CID',
collectionScanWritten: 'Written',
collectionScanFailed: 'Failed',
collectionScanLatest: 'Latest Result',
```

- [ ] **Step 4: Add Inject component state and methods**

In `src/inject/App.vue`, add refs:

```js
const collectionScanState = ref(null);
const collectionScanError = ref('');
const collectionScanLoading = ref('');
const collectionScanInputs = ref({
  scanIntervalMinutes: '60',
  itemDelaySeconds: '5',
  itemJitterSeconds: '5',
});
let removeCollectionScanListener = null;
```

Add computed capability:

```js
const canUseCollectionPriceScan = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.startCollectionPriceScan === 'function' &&
    typeof window.bidkingDesktop?.stopCollectionPriceScan === 'function' &&
    typeof window.bidkingDesktop?.getCollectionPriceScanStatus === 'function',
  ),
);
```

Add helpers:

```js
function applyCollectionScanState(state) {
  collectionScanState.value = state || { state: 'idle' };
  if (state?.config) {
    collectionScanInputs.value = {
      scanIntervalMinutes: String(state.config.scanIntervalMinutes ?? collectionScanInputs.value.scanIntervalMinutes),
      itemDelaySeconds: String(state.config.itemDelaySeconds ?? collectionScanInputs.value.itemDelaySeconds),
      itemJitterSeconds: String(state.config.itemJitterSeconds ?? collectionScanInputs.value.itemJitterSeconds),
    };
  }
}

function getCollectionScanConfig() {
  return {
    scanIntervalMinutes: Number(collectionScanInputs.value.scanIntervalMinutes),
    itemDelaySeconds: Number(collectionScanInputs.value.itemDelaySeconds),
    itemJitterSeconds: Number(collectionScanInputs.value.itemJitterSeconds),
  };
}

async function refreshCollectionScanStatus() {
  if (!canUseCollectionPriceScan.value) return;
  const state = await window.bidkingDesktop.getCollectionPriceScanStatus();
  applyCollectionScanState(state);
}

async function startCollectionPriceScan() {
  if (!canUseCollectionPriceScan.value || collectionScanLoading.value) return;
  collectionScanLoading.value = 'start';
  collectionScanError.value = '';
  try {
    applyCollectionScanState(await window.bidkingDesktop.startCollectionPriceScan(getCollectionScanConfig()));
  } catch (error) {
    collectionScanError.value = error?.message || String(error);
  } finally {
    collectionScanLoading.value = '';
  }
}

async function stopCollectionPriceScan() {
  if (!canUseCollectionPriceScan.value || collectionScanLoading.value) return;
  collectionScanLoading.value = 'stop';
  collectionScanError.value = '';
  try {
    applyCollectionScanState(await window.bidkingDesktop.stopCollectionPriceScan());
  } catch (error) {
    collectionScanError.value = error?.message || String(error);
  } finally {
    collectionScanLoading.value = '';
  }
}
```

In `onMounted`, call `refreshCollectionScanStatus()` and subscribe:

```js
removeCollectionScanListener = window.bidkingDesktop?.onCollectionPriceScanState?.((state) => {
  applyCollectionScanState(state);
}) ?? null;
```

Add `onUnmounted` if not already imported:

```js
onUnmounted(() => {
  removeCollectionScanListener?.();
});
```

- [ ] **Step 5: Add panel template**

Add this section in the AutoOperation Agent area:

```vue
<section v-if="canUseCollectionPriceScan" class="auto-operation-card" data-testid="collection-price-scan-panel">
  <div class="panel-heading">
    <div>
      <h2>{{ t('inject.collectionScanTitle') }}</h2>
      <p>{{ t('inject.collectionScanDescription') }}</p>
    </div>
  </div>
  <div class="form-grid compact-grid">
    <label>
      <span>{{ t('inject.collectionScanInterval') }}</span>
      <input data-testid="collection-scan-interval" v-model="collectionScanInputs.scanIntervalMinutes" type="number" min="1" max="1440">
    </label>
    <label>
      <span>{{ t('inject.collectionScanItemDelay') }}</span>
      <input data-testid="collection-scan-item-delay" v-model="collectionScanInputs.itemDelaySeconds" type="number" min="0" max="3600">
    </label>
    <label>
      <span>{{ t('inject.collectionScanItemJitter') }}</span>
      <input data-testid="collection-scan-item-jitter" v-model="collectionScanInputs.itemJitterSeconds" type="number" min="0" max="3600">
    </label>
  </div>
  <div class="button-row">
    <button data-testid="collection-scan-start" type="button" :disabled="Boolean(collectionScanLoading)" @click="startCollectionPriceScan">
      {{ t('inject.collectionScanStart') }}
    </button>
    <button data-testid="collection-scan-stop" type="button" :disabled="Boolean(collectionScanLoading)" @click="stopCollectionPriceScan">
      {{ t('inject.collectionScanStop') }}
    </button>
  </div>
  <div class="status-grid">
    <span>{{ t('inject.collectionScanState') }}</span>
    <strong>{{ collectionScanState?.state || 'idle' }}</strong>
    <span>{{ t('inject.collectionScanProgress') }}</span>
    <strong>{{ collectionScanState?.completedCount || 0 }} / {{ collectionScanState?.itemCount || 0 }}</strong>
    <span>{{ t('inject.collectionScanCurrentCid') }}</span>
    <strong>{{ collectionScanState?.currentCid || '-' }}</strong>
    <span>{{ t('inject.collectionScanWritten') }}</span>
    <strong>{{ collectionScanState?.writtenCount || 0 }}</strong>
    <span>{{ t('inject.collectionScanFailed') }}</span>
    <strong>{{ collectionScanState?.failedCount || 0 }}</strong>
    <span>{{ t('inject.collectionScanLatest') }}</span>
    <strong>{{ collectionScanState?.lastResult?.minPrice ? formatNumber(collectionScanState.lastResult.minPrice) : '-' }}</strong>
  </div>
  <p v-if="collectionScanError" class="error-text">{{ collectionScanError }}</p>
</section>
```

If `formatNumber` is not available in `App.vue`, add:

```js
function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '-';
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- src/inject/App.test.js
```

Expected: all Inject tests pass.

Commit:

```bash
git add src/inject/App.vue src/inject/App.test.js src/inject/inject.css src/shared/messages.js
git commit -m "feat: add collection price scan panel"
```

---

## Task 6: Final Integration Verification and Cleanup Docs

**Files:**
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`
- Modify: `docs/superpowers/specs/2026-06-02-agent-collection-price-scheduler-design.md`

- [ ] **Step 1: Update docs with UI workflow**

In `docs/AUTO_OPERATION_COMMANDS.md`, add a short section:

```markdown
## Collection Price Scan UI

The Inject page collection price scan panel uses BKToolBox-side orchestration.
The Agent only provides `GetCollectionItemCids` and `GetItemTradeInfo`.
BKToolBox writes `Documents\BKPriceHistory\Cids.json`, per-item CSV history,
ladder JSONL, and `latest.json`.

The old topbar schedule switch is not part of the new workflow.
```

- [ ] **Step 2: Run full verification commands**

Run:

```bash
g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/TradeListSummary.test.cpp -o /tmp/bk_trade_summary_test && /tmp/bk_trade_summary_test
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
npm test -- lib/trade-info-history-recorder.test.mjs electron/services/collection-price-scan-controller.test.mjs electron/services/inject-service.test.mjs src/shared/TopBar.test.js src/inject/App.test.js
npm run build:inject
```

Expected:

- C++ pure test exits `0`.
- Agent DLL build prints `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`.
- Vitest reports all selected files passed.
- `build:inject` exits `0`.

- [ ] **Step 3: Commit docs and build artifacts**

Check `git status --short`. Stage only files modified by this implementation and any intentional `public/inject` build output changes. Do not stage unrelated `public/price`, `tmp`, or old plan files.

Commit:

```bash
git add docs/AUTO_OPERATION_COMMANDS.md docs/superpowers/specs/2026-06-02-agent-collection-price-scheduler-design.md public/inject
git commit -m "docs: document agent collection price scan"
```

If `public/inject` was not changed by `npm run build:inject`, omit it from `git add`.
