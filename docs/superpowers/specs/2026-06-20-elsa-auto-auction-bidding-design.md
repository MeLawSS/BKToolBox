# Elsa Auto Auction Bidding Design

**Goal:** Implement the actual bidding script inside the Elsa auto-operation mode. When enabled, the script syncs the current Elsa expected price to the agent and runs one full automated auction session using per-round bid multipliers. The mode auto-disables after the auction completes.

**Architecture:** Three coordinated changes:
1. DLL — new `SetExpectedPrice` command + `AutoAuction` gains a `useExpectedPrice` flag that activates per-round multiplier bidding
2. Shared price bridge — a small reactive singleton `elsaEstimateState.js` bridges the component tree gap between the estimator and the auto-operation composable
3. App — `useElsaAutoOperation.js` watches the shared price and drives the auction script

**Tech Stack:** C++ (`MetaOperations.cpp`, `AggregateOperationSemantics.h`, `BKAutoOpAgent.cpp`), Vue 3 Composition API (`useHeroEstimatorPanel.js`, `useElsaAutoOperation.js`)

## Global Constraints

- No TypeScript — plain `.js` / `.vue` files; Vue 3 `<script setup>` throughout
- Activity log strings in `useElsaAutoOperation.js` are hardcoded (not i18n'd)
- `AutoAuction` backward compatibility: existing `bidAmount` behavior is unchanged. The new `useExpectedPrice` flag is opt-in — absent means false, so bkcli and any other caller without the flag continue to work exactly as before
- DLL global state uses `std::atomic<int>` for thread safety
- App-side price watcher active only while `isEnabled` is true; torn down in `disable()`
- `runScript` runs `AutoAuction` exactly once; on resolve or reject, `disable()` is called automatically
- `const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args)` is declared at composable scope in `useElsaAutoOperation.js` — used by both the price watcher and `runScript`
- `refreshEstimateAfterMonitorUpdate()` in `useHeroEstimatorPanel.js` already auto-re-estimates when monitor data changes (gated by `hasCalculated.value`). No additional auto-estimation watcher is needed

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

Parse `price` from JSON, store in `g_expectedPrice`, respond with the stored value. Register in the command table in `BKAutoOpAgent.cpp` and declare in `MetaOperations.h`.

### 1.3 New pure function: `ComputeBidAmount`

Add to `AggregateOperationSemantics.h` (inline, no dependencies, unit-testable):

```cpp
// roundsEncountered: number of distinct auction rounds seen so far (1-indexed, i.e. first round = 1)
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
assert(ComputeBidAmount(0, 1) == 0);   // no price set → skip
assert(ComputeBidAmount(-1, 1) == 0);  // negative → skip
assert(ComputeBidAmount(10000, 1) == 20000); // round 1 → 2.0x
assert(ComputeBidAmount(10000, 2) == 17000); // round 2 → 1.7x
assert(ComputeBidAmount(10000, 3) == 10000); // round 3 → 1.0x
assert(ComputeBidAmount(10000, 5) == 10000); // round 5+ → 1.0x
```

### 1.4 Modify `CmdAutoAuction`: add `useExpectedPrice` flag

**Do not change the `bidAmount` default.** Instead, parse a new boolean flag:

```cpp
int bidAmount     = JsonGetInt(json, "bidAmount");     if (bidAmount     == INT_MIN) bidAmount     = 25000;
int useExpPrice   = JsonGetInt(json, "useExpectedPrice"); // INT_MIN = absent = false
bool useExpectedPrice = (useExpPrice != INT_MIN && useExpPrice != 0);
```

**Track `roundsEncountered` separately from `roundsPlayed`:**

`roundsEncountered` increments each time a new distinct round string is seen (regardless of bid success or skip), and is used for `ComputeBidAmount`. `roundsPlayed` continues to track only successful bids (for the response field). This ensures that if a round is skipped (e.g., because the price is not yet set), subsequent rounds still get the correct multiplier.

```cpp
std::string lastBidRound;
std::string lastRoundSeen;
int roundsEncountered = 0;
int roundsPlayed = 0;
int lastExpectedPrice = 0;
```

In the bid loop, before attempting to bid:

```cpp
// Track round progression regardless of bid outcome
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

    // existing PlaceBid / SetBidAmount / ConfirmBid flow using `amount`
    // ...
    if (ShouldCountAutoAuctionRound(...)) {
        lastBidRound = round;
        roundsPlayed++;
    }
}
```

**Update success response** to include the last-read expected price:

```json
{ "result": "auction_ended", "rounds": <n>, "expectedPrice": <lastExpectedPrice> }
```

---

## Part 2: Shared Price Bridge

### 2.1 New file: `src/elsa/elsaEstimateState.js`

A tiny module-level reactive singleton. Both `useHeroEstimatorPanel.js` and `useElsaAutoOperation.js` import from it — no component prop-passing needed.

```javascript
import { ref } from 'vue';
export const elsaExpectedPrice = ref(0);
```

### 2.2 Write to `elsaExpectedPrice` from `useHeroEstimatorPanel.js`

Inside `useHeroEstimatorPanel`, after `summary` is defined, add a watcher:

```javascript
import { elsaExpectedPrice } from '../elsa/elsaEstimateState.js';

// near the end of the composable, before the return:
watch(
  () => summary.total,
  (total) => { elsaExpectedPrice.value = Math.round(total) || 0; },
  { immediate: true },
);
```

This writes to the singleton whenever the estimator recalculates (including the existing `refreshEstimateAfterMonitorUpdate` auto-refresh path).

---

## Part 3: App Side — `useElsaAutoOperation.js`

### 3.1 Composable-scope `cmd`

Add at the top of `useElsaAutoOperation()` function body (before any async functions):

```javascript
const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);
```

### 3.2 Price watcher

Import `elsaExpectedPrice` from the shared bridge:

```javascript
import { elsaExpectedPrice } from './elsaEstimateState.js';
```

Add a stop-handle variable at composable scope:

```javascript
let stopPriceWatcher = null;
```

In `enable()`, after `isEnabled.value = true`, start the watcher:

```javascript
stopPriceWatcher = watch(elsaExpectedPrice, (price) => {
  cmd('SetExpectedPrice', { price })
    .then(() => addLog(`估价已更新: ${price}`))
    .catch(e => addLog(`价格同步失败: ${e?.message || e}`, 'warn'));
});
```

No `{ immediate: true }` — the initial sync is done explicitly at the start of `runScript` (see 3.3).

In `disable()`, before the existing cleanup:

```javascript
if (stopPriceWatcher) { stopPriceWatcher(); stopPriceWatcher = null; }
```

### 3.3 `runScript()` implementation

```javascript
async function runScript(signal) {
  if (signal.aborted) throw new Error('操作已取消');
  addLog('开始自动竞拍…');

  // Explicit initial sync — must await before AutoAuction starts
  const initialPrice = elsaExpectedPrice.value;
  await cmd('SetExpectedPrice', { price: initialPrice });
  addLog(`估价已更新: ${initialPrice}`);

  if (signal.aborted) throw new Error('操作已取消');

  const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
  // runAutoOperationCommand throws on failure; result is { ok: true, value: {...}, response }
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

### 3.5 Log messages (hardcoded, not i18n'd)

| Situation | Level | Message |
|-----------|-------|---------|
| Script starts | info | `'开始自动竞拍…'` |
| Initial price synced | info | `'估价已更新: {price}'` |
| Price updated mid-auction | info | `'估价已更新: {price}'` |
| Price sync failed | warn | `'价格同步失败: {error}'` |
| Auction complete | info | `'竞拍完成，共出价 N 轮，使用估价 P'` |
| Aborted | error | `'脚本异常: 操作已取消'` |
| Other error | error | `'脚本异常: {error}'` |

---

## What is NOT in scope

- Changing `roomId` from 101 (hardcoded for now)
- Looping across multiple auctions
- UI changes to `ElsaAutoOperationPanel.vue`
- i18n for any of the new log strings
- Cancelling an in-flight `AutoAuction` IPC call (stop only takes effect before the call or after it returns)
- Modifying `HeroEstimatorPanelBody.vue` or `ElsaHeroPanel.vue`
