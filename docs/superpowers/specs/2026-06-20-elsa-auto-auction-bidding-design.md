# Elsa Auto Auction Bidding Design

**Goal:** Implement the actual bidding script inside the Elsa auto-operation mode. When enabled, the script syncs the current Elsa expected price to the agent and runs one full automated auction session using per-round bid multipliers. The mode auto-disables after the auction completes.

**Architecture:** Three coordinated changes:
1. DLL — new `SetExpectedPrice` command + `AutoAuction` gains a `useExpectedPrice` boolean flag that activates per-round multiplier bidding
2. Shared price bridge — a small reactive singleton `elsaEstimateState.js` bridges the component tree gap between the estimator and the auto-operation composable; `useHeroEstimatorPanel.js` writes to it only when `profile.id === 'elsa'`
3. App — `useElsaAutoOperation.js` reads the shared price, validates it is non-zero before starting, and drives the auction script

**Tech Stack:** C++ (`MetaOperations.cpp`, `AggregateOperationSemantics.h`, `BKAutoOpAgent.cpp`), Vue 3 Composition API (`useHeroEstimatorPanel.js`, `useElsaAutoOperation.js`)

## Global Constraints

- No TypeScript — plain `.js` / `.vue` files; Vue 3 `<script setup>` throughout
- Activity log strings in `useElsaAutoOperation.js` are hardcoded (not i18n'd)
- `AutoAuction` backward compatibility: `bidAmount` default (25000) and existing behavior are unchanged. `useExpectedPrice` is opt-in — absent means false
- DLL global state uses `std::atomic<int>` for thread safety
- App-side price watcher active only while `isEnabled` is true; torn down in `disable()`
- `runScript` runs `AutoAuction` exactly once; on resolve or reject, `.finally(() => disable())` is called — `disable()` is idempotent (guards on `!isEnabled.value`)
- `const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args)` declared at composable scope, used by both the price watcher and `runScript`
- `refreshEstimateAfterMonitorUpdate()` in `useHeroEstimatorPanel.js` already auto-re-estimates when monitor data changes (gated by `hasCalculated.value`). No additional auto-estimation watcher is needed
- Do not modify `HeroEstimatorPanelBody.vue` or `ElsaHeroPanel.vue`

---

## Part 1: DLL Side

### 1.1 New global: `g_expectedPrice`

Add at file scope in `MetaOperations.cpp`:

```cpp
static std::atomic<int> g_expectedPrice{0};
```

### 1.2 New command: `SetExpectedPrice`

```
Command: SetExpectedPrice
Params:  { "price": <int> }   — non-negative integer
Returns: { "ok": true, "price": <n> }
```

Parse `price` from JSON via `JsonGetInt`, store in `g_expectedPrice`, respond with the stored value. Register in the command table in `BKAutoOpAgent.cpp` and declare in `MetaOperations.h`.

### 1.3 New pure function: `ComputeBidAmount`

Add to `AggregateOperationSemantics.h` (inline, no dependencies, unit-testable):

```cpp
// roundsEncountered: 1-indexed count of distinct auction rounds seen (first round = 1)
// Returns bid amount as integer (truncated). Returns 0 if expectedPrice <= 0.
inline int ComputeBidAmount(int expectedPrice, int roundsEncountered) {
    if (expectedPrice <= 0) return 0;
    double multiplier = (roundsEncountered == 1) ? 2.0
                      : (roundsEncountered == 2) ? 1.7
                      :                            1.0;
    return static_cast<int>(expectedPrice * multiplier);
}
```

Add test cases to `AggregateOperationSemantics.test.cpp`:

```cpp
assert(ComputeBidAmount(0, 1)     == 0);     // price not set → skip
assert(ComputeBidAmount(-1, 1)    == 0);     // negative → skip
assert(ComputeBidAmount(10000, 1) == 20000); // round 1 → 2.0x
assert(ComputeBidAmount(10000, 2) == 17000); // round 2 → 1.7x
assert(ComputeBidAmount(10000, 3) == 10000); // round 3 → 1.0x
assert(ComputeBidAmount(10000, 5) == 10000); // round 5+ → 1.0x
```

### 1.4 Modify `CmdAutoAuction`: add `useExpectedPrice` flag

**Do not change `bidAmount` or its default.** Parse a new boolean flag using `JsonGetBool` (which handles JS `true`/`false` literals):

```cpp
int bidAmount = JsonGetInt(json, "bidAmount");
if (bidAmount == INT_MIN) bidAmount = 25000;

bool useExpectedPrice = false;
JsonGetBool(json, "useExpectedPrice", &useExpectedPrice);
```

**Track `roundsEncountered` separately from `roundsPlayed`:**

`roundsEncountered` increments on each new distinct round string seen, regardless of whether a bid was placed or skipped — this ensures the correct multiplier is applied even if a round is skipped. `roundsPlayed` counts only successful bids and is reported in the response.

```cpp
std::string lastBidRound;
std::string lastRoundSeen;
int roundsEncountered = 0;
int roundsPlayed = 0;
int lastExpectedPrice = 0;
```

In the bid loop, replace the existing round-check block:

```cpp
// Advance round counter on every new in-game round (regardless of bid outcome)
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

    // existing PlaceBid / SetBidAmount / ConfirmBid flow, using `amount`
    // ...
    if (ShouldCountAutoAuctionRound(...)) {
        lastBidRound = round;
        roundsPlayed++;
    }
}
```

**Update success response:**

```json
{ "result": "auction_ended", "rounds": <n>, "expectedPrice": <lastExpectedPrice> }
```

---

## Part 2: Shared Price Bridge

### 2.1 New file: `src/elsa/elsaEstimateState.js`

```javascript
import { ref } from 'vue';
export const elsaExpectedPrice = ref(0);
```

### 2.2 Write to `elsaExpectedPrice` from `useHeroEstimatorPanel.js`

`useHeroEstimatorPanel` is used by all hero profiles. The write must be gated to Elsa, and must reflect **only fresh calculations** — not restored state from localStorage.

**Why no `immediate: true`:** `useHeroEstimatorPanel` runs `restoreState()` at init time, which calls `Object.assign(summary, ...)` before the watcher is registered. Since `watch()` only fires for changes made *after* registration, omitting `immediate: true` means restored values do not seed the singleton. `elsaExpectedPrice` stays 0 until the user runs a fresh estimate in the current session.

**Why reset on unmount:** The singleton is module-level and survives component unmounts. Without a reset, a price from a previous session could persist into the next. Resetting on unmount forces a fresh estimate on each visit.

Add two imports at the top of `useHeroEstimatorPanel.js`:

```javascript
import { onUnmounted } from 'vue';
import { elsaExpectedPrice } from '../elsa/elsaEstimateState.js';
```

Inside `useHeroEstimatorPanel(profile)`, near the end of the composable body (before `return`):

```javascript
if (profile.id === 'elsa') {
  watch(
    () => summary.total,
    (total) => { elsaExpectedPrice.value = Math.round(total) || 0; },
    // No immediate: true — restored values must not be treated as fresh estimates
  );
  onUnmounted(() => { elsaExpectedPrice.value = 0; });
}
```

---

## Part 3: App Side — `useElsaAutoOperation.js`

### 3.1 Composable-scope `cmd`

Add two imports at the top of `useElsaAutoOperation.js` (alongside existing imports):

```javascript
import { watch } from 'vue';
import { elsaExpectedPrice } from './elsaEstimateState.js';
```

Add inside `useElsaAutoOperation()`, before any async functions:

```javascript
const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);
```

### 3.2 Price watcher

Add a stop-handle at composable scope:

```javascript
let stopPriceWatcher = null;
```

In `enable()`, after `isEnabled.value = true`:

```javascript
stopPriceWatcher = watch(elsaExpectedPrice, (price) => {
  cmd('SetExpectedPrice', { price })
    .then(() => addLog(`估价已更新: ${price}`))
    .catch(e => addLog(`价格同步失败: ${e?.message || e}`, 'warn'));
});
```

No `{ immediate: true }` — the initial sync is done explicitly at the start of `runScript`.

In `disable()`, before the existing cleanup:

```javascript
if (stopPriceWatcher) { stopPriceWatcher(); stopPriceWatcher = null; }
```

### 3.3 `runScript()` implementation

```javascript
async function runScript(signal) {
  if (signal.aborted) throw new Error('操作已取消');
  addLog('开始自动竞拍…');

  // Guard: require a valid estimate before starting
  const initialPrice = elsaExpectedPrice.value;
  if (!initialPrice) throw new Error('请先运行估算后再开启自动竞拍');

  // Explicit initial sync — awaited before AutoAuction starts
  await cmd('SetExpectedPrice', { price: initialPrice });
  addLog(`估价已更新: ${initialPrice}`);

  if (signal.aborted) throw new Error('操作已取消');

  const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
  // runAutoOperationCommand resolves to { ok: true, value: {...}, response }
  const rounds = result?.value?.rounds ?? 0;
  const price  = result?.value?.expectedPrice ?? 0;
  addLog(`竞拍完成，共出价 ${rounds} 轮，使用估价 ${price}`);
}
```

### 3.4 Auto-disable after script completes

Change the `runScript` invocation in `enable()`:

```javascript
// Before:
runScript(controller.signal).catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'));

// After:
runScript(controller.signal)
  .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
  .finally(() => disable());
```

`disable()` guards on `!isEnabled.value`, so the `.finally()` call is safe even if the user already pressed stop manually.

### 3.5 Stop behavior

When the user presses stop while `AutoAuction` is in flight:

1. `disable()` runs — price watcher torn down, `isEnabled = false`, `agent.unloadAgent()` called (if owned)
2. The DLL's unload guard (`BKAutoOpAgent.cpp:3781`) waits up to 10 s for active connection handlers to finish. Since `CmdAutoAuction` is still an active handler, the unload **cancels** after 10 s and the agent remains loaded
3. The renderer-side `waitForAutoOperationAgentToUnload` eventually times out or errors
4. The in-flight `cmd('AutoAuction', ...)` continues until the auction ends naturally (up to the 600 s IPC timeout); when it resolves, `runScript` logs the result
5. `.finally(() => disable())` is called — no-op because `isEnabled` is already false

**Consequence:** pressing stop while an auction is in progress disables the UI immediately but does not interrupt the in-game auction. The agent stays alive for the duration. This is acceptable behavior for this feature; native mid-flight cancellation is out of scope.

### 3.6 Log messages (hardcoded, not i18n'd)

| Situation | Level | Message |
|-----------|-------|---------|
| Script starts | info | `'开始自动竞拍…'` |
| No estimate yet | error | `'请先运行估算后再开启自动竞拍'` |
| Initial price synced | info | `'估价已更新: {price}'` |
| Price updated mid-auction | info | `'估价已更新: {price}'` |
| Price sync failed | warn | `'价格同步失败: {error}'` |
| Auction complete | info | `'竞拍完成，共出价 N 轮，使用估价 P'` |
| Any error (incl. aborted) | error | `'脚本异常: {error}'` (from `.catch` in `enable()`) |

---

## What is NOT in scope

- Changing `roomId` from 101 (hardcoded for now)
- Looping across multiple auctions
- UI changes to `ElsaAutoOperationPanel.vue`
- i18n for any new log strings
- Modifying `HeroEstimatorPanelBody.vue` or `ElsaHeroPanel.vue`
