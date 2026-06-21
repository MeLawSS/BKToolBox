# Elsa Auto Auction Bidding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the actual bidding script in the Elsa auto-operation mode: a shared price bridge syncs the Elsa expected price to the DLL agent, which then runs a full automated auction using per-round bid multipliers (2×, 1.7×, 1× for rounds 1, 2, 3+).

**Architecture:** Four tasks in order. Tasks 1–2 are DLL-only (C++); Tasks 3–4 are app-only (JS/Vue). Tasks 3 and 4 have a data dependency (Task 3 creates `elsaEstimateState.js` which Task 4 imports), so they must run sequentially. Tasks 1 and 2 must also run sequentially (Task 1 defines `ComputeBidAmount` which Task 2 calls). Tasks 1–2 and Tasks 3–4 are independent of each other and can be done in any order.

**Tech Stack:** C++11 (`MetaOperations.cpp`, `AggregateOperationSemantics.h`, `BKAutoOpAgent.cpp`), cross-compiled with `x86_64-w64-mingw32-g++`; Vue 3 Composition API, Vitest for JS tests.

## Global Constraints

- No TypeScript — plain `.js` / `.vue` files; Vue 3 `<script setup>` throughout
- `AutoAuction` backward compatibility: `bidAmount` default (25000) and all existing behavior unchanged; `useExpectedPrice` is a new opt-in boolean flag
- DLL global state uses `std::atomic<int>` for thread safety
- Activity log strings in `useElsaAutoOperation.js` are hardcoded Chinese strings — not i18n'd
- `refreshEstimateAfterMonitorUpdate()` in `useHeroEstimatorPanel.js` already auto-re-estimates when monitor data changes; no additional auto-estimation watcher is needed
- Do not modify `HeroEstimatorPanelBody.vue` or `ElsaHeroPanel.vue`

---

### Task 1: `ComputeBidAmount` pure function (C++)

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

**Interfaces:**
- Produces: `ComputeBidAmount(int expectedPrice, int roundsEncountered) -> int` — used by Task 2 in `CmdAutoAuction`

- [ ] **Step 1: Add `ComputeBidAmount` to `AggregateOperationSemantics.h`**

Open `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`. Append after the closing brace of `ShouldCountAutoAuctionRound`:

```cpp
// roundsEncountered: 1-indexed count of distinct auction rounds seen (first round = 1).
// Returns bid amount (truncated). Returns 0 if expectedPrice <= 0 — caller must skip bidding.
inline int ComputeBidAmount(int expectedPrice, int roundsEncountered) {
    if (expectedPrice <= 0) return 0;
    double multiplier = (roundsEncountered == 1) ? 2.0
                      : (roundsEncountered == 2) ? 1.7
                      :                            1.0;
    return static_cast<int>(expectedPrice * multiplier);
}
```

- [ ] **Step 2: Add test cases to `AggregateOperationSemantics.test.cpp`**

Open `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`. Before `return 0;`, append:

```cpp
    // ComputeBidAmount
    assert(ComputeBidAmount(0, 1)     == 0);     // price not set → 0
    assert(ComputeBidAmount(-1, 1)    == 0);     // negative → 0
    assert(ComputeBidAmount(10000, 1) == 20000); // round 1 → 2.0x
    assert(ComputeBidAmount(10000, 2) == 17000); // round 2 → 1.7x
    assert(ComputeBidAmount(10000, 3) == 10000); // round 3 → 1.0x
    assert(ComputeBidAmount(10000, 5) == 10000); // round 5+ → 1.0x
```

- [ ] **Step 3: Compile and run the test to verify it passes**

Run from the repo root (requires `g++` in PATH):

```bash
g++ -std=c++11 -o /tmp/test_agg_ops \
  tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp \
  && /tmp/test_agg_ops && echo "ALL PASS"
```

Expected output: `ALL PASS`

- [ ] **Step 4: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "feat(agent): add ComputeBidAmount multiplier function"
```

---

### Task 2: DLL — `SetExpectedPrice` command + `AutoAuction` modification

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Output: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll` (rebuilt)

**Interfaces:**
- Consumes: `ComputeBidAmount` from Task 1 (already in `AggregateOperationSemantics.h` which `MetaOperations.cpp` already includes)
- Produces:
  - DLL command `SetExpectedPrice { "price": <int> }` → `{ "ok": true, "price": <n> }`
  - `AutoAuction` with `{ ..., "useExpectedPrice": true }` uses per-round multipliers; response gains `"expectedPrice"` field

- [ ] **Step 1: Add `g_expectedPrice` global and `CmdSetExpectedPrice` to `MetaOperations.cpp`**

Open `MetaOperations.cpp`. After the existing includes (line 3, after `#include "AggregateOperationSemantics.h"`), add:

```cpp
static std::atomic<int> g_expectedPrice{0};
```

Then find the `// AutoAuction aggregate operation` section header (around line 675). Just before it, insert the new command:

```cpp
// --------------------------------------------------------------------------
// SetExpectedPrice: store expected price for use by AutoAuction
// --------------------------------------------------------------------------
// Params:  { "price": <int> }
// Returns: { "ok": true, "price": <n> }
void CmdSetExpectedPrice(AgentConn* c, const char* id, const char* json) {
    int price = JsonGetInt(json, "price");
    if (price == INT_MIN) price = 0;
    if (price < 0) price = 0;
    g_expectedPrice.store(price);
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"price\":%d}", price);
    SendResponse(c, id, true, buf);
}
```

- [ ] **Step 2: Declare `CmdSetExpectedPrice` in `MetaOperations.h`**

Open `MetaOperations.h`. After line 101 (`void CmdAutoAuction(...)`), add:

```cpp
void CmdSetExpectedPrice(AgentConn* c, const char* id, const char* json);
```

- [ ] **Step 3: Register `SetExpectedPrice` in the command table in `BKAutoOpAgent.cpp`**

Open `BKAutoOpAgent.cpp`. Find the command table entry for `AutoAuction` (line 3926):

```cpp
    { "AutoAuction",           CmdAutoAuction           },
```

Insert a new line directly before it:

```cpp
    { "SetExpectedPrice",      CmdSetExpectedPrice      },
    { "AutoAuction",           CmdAutoAuction           },
```

- [ ] **Step 4: Modify `CmdAutoAuction` — parse `useExpectedPrice` flag**

Open `MetaOperations.cpp`. Find the start of `CmdAutoAuction` (around line 722). Find the existing parameter parsing block:

```cpp
    int roomId    = JsonGetInt(json, "roomId");    if (roomId    == INT_MIN) roomId    = 101;
    int bidAmount = JsonGetInt(json, "bidAmount"); if (bidAmount == INT_MIN) bidAmount = 25000;
```

Replace with (adds `useExpectedPrice` flag and `bool` parse — do NOT change `bidAmount` default):

```cpp
    int roomId    = JsonGetInt(json, "roomId");    if (roomId    == INT_MIN) roomId    = 101;
    int bidAmount = JsonGetInt(json, "bidAmount"); if (bidAmount == INT_MIN) bidAmount = 25000;

    bool useExpectedPrice = false;
    JsonGetBool(json, "useExpectedPrice", &useExpectedPrice);
```

- [ ] **Step 5: Replace the bid loop variable declarations in `CmdAutoAuction`**

Find the existing bid loop variable block (around line 807):

```cpp
    // Step 6: bid loop
    std::string lastBidRound;
    int roundsPlayed = 0;
```

Replace with:

```cpp
    // Step 6: bid loop
    std::string lastBidRound;
    std::string lastRoundSeen;
    int roundsEncountered = 0;
    int roundsPlayed = 0;
    int lastExpectedPrice = 0;
```

- [ ] **Step 6: Replace the bid loop body in `CmdAutoAuction`**

Find the existing bid attempt block inside the loop (starting with `if (secs < 30 && !round.empty() && round != lastBidRound) {`, around line 822). Replace the entire block — from that `if` through the closing `}` of `ShouldCountAutoAuctionRound` — with:

```cpp
        // Advance round counter on every new distinct in-game round
        if (!round.empty() && round != lastRoundSeen) {
            lastRoundSeen = round;
            roundsEncountered++;
        }

        if (secs < 30 && !round.empty() && round != lastBidRound) {
            int amount = useExpectedPrice
                ? ComputeBidAmount(g_expectedPrice.load(), roundsEncountered)
                : bidAmount;
            lastExpectedPrice = g_expectedPrice.load();

            if (amount == 0) continue; // skip — price not set yet

            std::string clickErr;
            bool placeBidClicked = ClickNode(s.battleMainTransform, "Gaming/chujia", 1500, &clickErr);
            bool hasBattleMainAfterClick = false;
            bool hasActiveBidInput = false;
            bool setBidAmountSucceeded = false;
            bool confirmBidClicked = false;

            if (placeBidClicked) {
                ScreenState s2 = DetectScreenState();
                hasBattleMainAfterClick = s2.battleMainTransform != nullptr;
                if (s2.battleMainTransform) {
                    std::vector<UiNodeSnapshot> inputM;
                    ResolveUiNodeMatches(s2.battleMainTransform,
                        "InputDevice/Panel1/InputField (TMP)", UI_PATH_EXACT, 1, &inputM);
                    hasActiveBidInput = !inputM.empty() && inputM[0].active;
                    if (hasActiveBidInput) {
                        char amountStr[32];
                        snprintf(amountStr, sizeof(amountStr), "%d", amount);
                        std::string compName;
                        setBidAmountSucceeded = PerformSetInputText(inputM[0], amountStr, false, &compName);
                        if (setBidAmountSucceeded) {
                            Sleep(500);
                            confirmBidClicked = ClickNode(s2.battleMainTransform, "InputDevice/Panel1/chujia", 1500, &clickErr);
                        }
                    }
                }
            }

            if (ShouldCountAutoAuctionRound(
                placeBidClicked,
                hasBattleMainAfterClick,
                hasActiveBidInput,
                setBidAmountSucceeded,
                confirmBidClicked
            )) {
                lastBidRound = round;
                roundsPlayed++;
            }
        }
```

- [ ] **Step 7: Update the success response in `CmdAutoAuction`**

Find the final response (line 895–897):

```cpp
    char result[64];
    snprintf(result, sizeof(result), "{\"result\":\"auction_ended\",\"rounds\":%d}", roundsPlayed);
    SendResponse(c, id, true, result);
```

Replace with (larger buffer, adds `expectedPrice`):

```cpp
    char result[128];
    snprintf(result, sizeof(result),
        "{\"result\":\"auction_ended\",\"rounds\":%d,\"expectedPrice\":%d}",
        roundsPlayed, lastExpectedPrice);
    SendResponse(c, id, true, result);
```

- [ ] **Step 8: Rebuild the DLL**

Run from the repo root:

```bash
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected output: `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`

If compilation fails, re-check Steps 4–7 for typos or mismatched braces.

- [ ] **Step 9: Smoke-test `SetExpectedPrice` with bkcli**

With the game running and agent injected:

```bash
node tools/bkcli/bkcli.js set-expected-price --price 30000
```

Wait — bkcli doesn't have this command yet. Instead, test via the agent panel in the app: use the Controller tab, command `SetExpectedPrice`, args `{"price": 30000}`. Verify response: `{"ok":true,"price":30000}`.

- [ ] **Step 10: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h \
        tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git commit -m "feat(agent): add SetExpectedPrice command and per-round multiplier bidding in AutoAuction"
```

---

### Task 3: Price bridge — `elsaEstimateState.js` + `useHeroEstimatorPanel.js` watcher

**Files:**
- Create: `src/elsa/elsaEstimateState.js`
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js` (lines 1–2 for imports, ~line 1757 for watcher)

**Interfaces:**
- Produces: `elsaExpectedPrice` — a Vue `ref<number>` exported from `src/elsa/elsaEstimateState.js`; used by Task 4

- [ ] **Step 1: Write the failing test**

Create `src/elsa/elsaEstimateState.test.js`:

```javascript
/* @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { elsaExpectedPrice } from './elsaEstimateState.js';

describe('elsaEstimateState', () => {
  beforeEach(() => {
    elsaExpectedPrice.value = 0;
  });

  it('starts at 0', () => {
    expect(elsaExpectedPrice.value).toBe(0);
  });

  it('can be updated and read', () => {
    elsaExpectedPrice.value = 42000;
    expect(elsaExpectedPrice.value).toBe(42000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/elsa/elsaEstimateState.test.js
```

Expected: FAIL — `Cannot find module './elsaEstimateState.js'`

- [ ] **Step 3: Create `src/elsa/elsaEstimateState.js`**

```javascript
import { ref } from 'vue';
export const elsaExpectedPrice = ref(0);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/elsa/elsaEstimateState.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 5: Add imports to `useHeroEstimatorPanel.js`**

Open `src/hero-estimator/useHeroEstimatorPanel.js`. On line 1, `onUnmounted` is not yet imported. Find the existing import on line 1:

```javascript
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
```

Replace with (add `onUnmounted`):

```javascript
import { computed, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
```

Then add a new import line after the last existing import (before the first non-import statement):

```javascript
import { elsaExpectedPrice } from '../elsa/elsaEstimateState.js';
```

- [ ] **Step 6: Add the profile-gated watcher and reset in `useHeroEstimatorPanel.js`**

Find the `return {` statement near line 1760. Directly before it, insert:

```javascript
  if (profile.id === 'elsa') {
    watch(
      () => summary.total,
      (total) => { elsaExpectedPrice.value = Math.round(total) || 0; },
      // No immediate: true — restored values from localStorage must not seed the price
    );
    onUnmounted(() => { elsaExpectedPrice.value = 0; });
  }
```

- [ ] **Step 7: Run the existing HeroEstimatorPanel test suite to verify no regressions**

```bash
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: all existing tests PASS

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/elsa/elsaEstimateState.js \
        src/elsa/elsaEstimateState.test.js \
        src/hero-estimator/useHeroEstimatorPanel.js
git commit -m "feat(elsa): add elsaEstimateState price bridge and estimator watcher"
```

---

### Task 4: `useElsaAutoOperation.js` — script implementation + tests

**Files:**
- Modify: `src/elsa/useElsaAutoOperation.js`
- Modify: `src/elsa/useElsaAutoOperation.test.js`

**Interfaces:**
- Consumes: `elsaExpectedPrice` from `src/elsa/elsaEstimateState.js` (Task 3)
- Consumes: `window.bidkingDesktop.runAutoOperationCommand` (existing bridge, mocked in tests)

- [ ] **Step 1: Write the failing tests**

Open `src/elsa/useElsaAutoOperation.test.js`. The file currently ends at the closing `});` of the `describe` block. Add these mocks and new test cases.

First, add to the existing mock setup at the top of the file (after the existing `vi.mock` calls):

```javascript
import { elsaExpectedPrice } from './elsaEstimateState.js';

vi.mock('./elsaEstimateState.js', () => {
  const { ref } = require('vue');
  const elsaExpectedPrice = ref(0);
  return { elsaExpectedPrice };
});
```

Then add to `beforeEach`:

```javascript
    elsaExpectedPrice.value = 0;
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn().mockResolvedValue({ ok: true, value: { rounds: 2, expectedPrice: 50000 }, response: {} }),
    };
```

Add these tests inside the existing `describe('useElsaAutoOperation', ...)` block, after the last existing test:

```javascript
  it('runScript() logs error and stays enabled when elsaExpectedPrice is 0', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 0;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(true); // enabled before runScript resolves
    await flushPromises(); // let runScript fire and resolve
    expect(result.log.value.some(e => e.level === 'error' && e.message.includes('请先运行估算'))).toBe(true);
    wrapper.unmount();
  });

  it('runScript() calls SetExpectedPrice then AutoAuction when price is set', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    const calls = window.bidkingDesktop.runAutoOperationCommand.mock.calls;
    const priceIdx = calls.findIndex(([name]) => name === 'SetExpectedPrice');
    const auctionIdx = calls.findIndex(([name]) => name === 'AutoAuction');
    expect(priceIdx).toBeGreaterThanOrEqual(0);
    expect(auctionIdx).toBeGreaterThan(priceIdx);
    expect(calls[priceIdx][1]).toEqual({ price: 50000 });
    expect(calls[auctionIdx][1]).toMatchObject({ roomId: 101, useExpectedPrice: true });
    wrapper.unmount();
  });

  it('disable() is called automatically after runScript completes', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(false); // auto-disabled after script
    expect(result.log.value.some(e => e.message.includes('竞拍完成'))).toBe(true);
    wrapper.unmount();
  });

  it('price watcher calls SetExpectedPrice when elsaExpectedPrice changes while enabled', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    // Prevent AutoAuction from resolving so we can change the price while "running"
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    const callsBefore = window.bidkingDesktop.runAutoOperationCommand.mock.calls.length;
    elsaExpectedPrice.value = 60000;
    await flushPromises();
    const newCalls = window.bidkingDesktop.runAutoOperationCommand.mock.calls.slice(callsBefore);
    expect(newCalls.some(([name, args]) => name === 'SetExpectedPrice' && args.price === 60000)).toBe(true);
    resolveAuction({ ok: true, value: { rounds: 1, expectedPrice: 60000 }, response: {} });
    await flushPromises();
    wrapper.unmount();
  });

  it('price watcher stops after disable()', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await result.disable();
    await flushPromises();
    const callsAfterDisable = window.bidkingDesktop.runAutoOperationCommand.mock.calls.length;
    elsaExpectedPrice.value = 99999;
    await flushPromises();
    const newCalls = window.bidkingDesktop.runAutoOperationCommand.mock.calls.length;
    expect(newCalls).toBe(callsAfterDisable); // no new SetExpectedPrice calls
    resolveAuction?.({ ok: true, value: { rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected: new tests FAIL; existing tests may still pass (the new tests reference `window.bidkingDesktop` and `elsaExpectedPrice` which don't yet affect `useElsaAutoOperation.js`)

- [ ] **Step 3: Add imports to `useElsaAutoOperation.js`**

Open `src/elsa/useElsaAutoOperation.js`. Find line 1:

```javascript
import { ref, computed, onBeforeUnmount } from 'vue';
```

Replace with (add `watch`):

```javascript
import { ref, computed, watch, onBeforeUnmount } from 'vue';
```

Then add a new import after the last existing import line (line 4):

```javascript
import { elsaExpectedPrice } from './elsaEstimateState.js';
```

- [ ] **Step 4: Add `cmd` and `stopPriceWatcher` to `useElsaAutoOperation.js`**

Inside `useElsaAutoOperation()` function body, after the existing `let weStartedAgent = false;` line (line 17), add:

```javascript
  const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);
  let stopPriceWatcher = null;
```

- [ ] **Step 5: Replace `runScript()` in `useElsaAutoOperation.js`**

Find the existing `runScript` function (lines 29–32):

```javascript
  async function runScript(/* signal */) {
    addLog('自动竞拍脚本已启动');
    // TODO: bidding logic
  }
```

Replace entirely with:

```javascript
  async function runScript(signal) {
    if (signal.aborted) throw new Error('操作已取消');
    addLog('开始自动竞拍…');

    const initialPrice = elsaExpectedPrice.value;
    if (!initialPrice) throw new Error('请先运行估算后再开启自动竞拍');

    await cmd('SetExpectedPrice', { price: initialPrice });
    addLog(`估价已更新: ${initialPrice}`);

    if (signal.aborted) throw new Error('操作已取消');

    const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
    const rounds = result?.value?.rounds ?? 0;
    const price  = result?.value?.expectedPrice ?? 0;
    addLog(`竞拍完成，共出价 ${rounds} 轮，使用估价 ${price}`);
  }
```

- [ ] **Step 6: Add price watcher in `enable()` and its teardown in `disable()`**

In `enable()`, find the block that sets `isEnabled.value = true` and starts the script (lines 57–60):

```javascript
      isEnabled.value = true;
      const controller = new AbortController();
      scriptAbort = controller;
      runScript(controller.signal).catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'));
```

Replace with (adds watcher start, auto-disable `.finally()`):

```javascript
      isEnabled.value = true;
      stopPriceWatcher = watch(elsaExpectedPrice, (price) => {
        cmd('SetExpectedPrice', { price })
          .then(() => addLog(`估价已更新: ${price}`))
          .catch(e => addLog(`价格同步失败: ${e?.message || e}`, 'warn'));
      });
      const controller = new AbortController();
      scriptAbort = controller;
      runScript(controller.signal)
        .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
        .finally(() => disable());
```

In `disable()`, find the first line of the try block (line 69, `isBusy.value = true;` and the abort line):

```javascript
    isBusy.value = true;
    if (scriptAbort) { scriptAbort.abort(); scriptAbort = null; }
```

Replace with (adds watcher teardown):

```javascript
    isBusy.value = true;
    if (stopPriceWatcher) { stopPriceWatcher(); stopPriceWatcher = null; }
    if (scriptAbort) { scriptAbort.abort(); scriptAbort = null; }
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected: all tests PASS

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS. Fix any regressions before continuing.

- [ ] **Step 9: Commit**

```bash
git add src/elsa/useElsaAutoOperation.js \
        src/elsa/useElsaAutoOperation.test.js
git commit -m "feat(elsa): implement auto auction bidding script with price sync and per-round multipliers"
```
