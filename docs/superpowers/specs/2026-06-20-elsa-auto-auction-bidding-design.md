# Elsa Auto Auction Bidding Design

**Goal:** Implement the actual bidding script inside the Elsa auto-operation mode. When enabled, the script syncs the current Elsa expected price to the agent and runs one full automated auction session using per-round bid multipliers. The mode auto-disables after the auction completes.

**Architecture:** Two coordinated changes — DLL side adds `SetExpectedPrice` command and modifies `AutoAuction` to use a stored global price with per-round multipliers when `bidAmount` is absent; app side adds a price watcher that pushes price updates to the agent and triggers automatic re-estimation, then runs `AutoAuction` once.

**Tech Stack:** C++ (DLL, `MetaOperations.cpp`, `AggregateOperationSemantics.h`), Vue 3 Composition API (`useHeroEstimatorPanel.js`, `useElsaAutoOperation.js`, `ElsaHeroPanel.vue`)

## Global Constraints

- No TypeScript — plain `.js` / `.vue` files
- Vue 3 `<script setup>` style throughout
- Activity log message strings in `useElsaAutoOperation.js` are hardcoded (not i18n'd)
- `AutoAuction` `bidAmount` parameter is preserved: if provided and non-zero, use it (existing behavior); if absent or zero, use `g_expectedPrice` with per-round multipliers
- DLL global state uses `std::atomic<int>` for thread safety
- App-side price watcher is active only while `isEnabled` is true; created in `enable()`, torn down in `disable()`
- `runScript` runs `AutoAuction` exactly once; when it resolves or rejects, `disable()` is called automatically
- `cmd` is a composable-level helper: `const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args)` — used by both `runScript` and the price watcher

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
// roundsPlayed: number of rounds already completed (0 = first round)
// Returns bid amount as integer (truncated). Returns 0 if expectedPrice <= 0.
inline int ComputeBidAmount(int expectedPrice, int roundsPlayed) {
    if (expectedPrice <= 0) return 0;
    double multiplier = (roundsPlayed == 0) ? 2.0
                      : (roundsPlayed == 1) ? 1.7
                      :                      1.0;
    return static_cast<int>(expectedPrice * multiplier);
}
```

Add test cases to `AggregateOperationSemantics.test.cpp`:

```cpp
// expectedPrice=0 → 0 for any round
assert(ComputeBidAmount(0, 0) == 0);
assert(ComputeBidAmount(0, 3) == 0);
// round multipliers
assert(ComputeBidAmount(10000, 0) == 20000);
assert(ComputeBidAmount(10000, 1) == 17000);
assert(ComputeBidAmount(10000, 2) == 10000);
assert(ComputeBidAmount(10000, 5) == 10000);
// negative price → 0
assert(ComputeBidAmount(-1, 0) == 0);
```

### 1.4 Modify `CmdAutoAuction`

**Fix default:** Change the fallback from 25000 to 0:

```cpp
// Before:
int bidAmount = JsonGetInt(json, "bidAmount");
if (bidAmount == INT_MIN) bidAmount = 25000;

// After:
int bidAmount = JsonGetInt(json, "bidAmount");
if (bidAmount == INT_MIN) bidAmount = 0;
```

**Per-round bid amount:** In the bid loop, before calling `PlaceBid`, compute the actual amount:

```cpp
int amount = (bidAmount != 0) ? bidAmount
                               : ComputeBidAmount(g_expectedPrice.load(), roundsPlayed);
if (amount == 0) {
    // expected price not set and no fixed amount — skip this round
    continue;
}
// use amount for SetBidAmount call
```

The per-round amount reads `g_expectedPrice` fresh each round, so `SetExpectedPrice` updates mid-auction take effect on subsequent rounds.

**Update response** to include the last-read expected price:

```json
{ "result": "auction_ended", "rounds": <n>, "expectedPrice": <last g_expectedPrice read> }
```

---

## Part 2: App Side

### 2.1 Expose `expectedTotalPrice` from `useHeroEstimatorPanel`

`useHeroEstimatorPanel.js` has an internal `summary` reactive object with `summary.total` (a number or null). Add to its `return` block:

```javascript
expectedTotalPrice: computed(() => summary.total ?? 0),
```

This is the only change to `useHeroEstimatorPanel.js`. Do not modify `HeroEstimatorPanelBody.vue`.

### 2.2 Pass `expectedTotalPrice` into `useElsaAutoOperation`

In `ElsaHeroPanel.vue`, the panel already calls both composables. Pass the estimator's price as a parameter:

```javascript
const estimator = useHeroEstimatorPanel(profile);
const autoOp = useElsaAutoOperation(estimator.expectedTotalPrice);
```

`useElsaAutoOperation` signature changes to:

```javascript
export function useElsaAutoOperation(expectedTotalPrice) { ... }
```

### 2.3 Auto-estimation on data change

`useHeroEstimatorPanel` exposes `handleSubmit` which triggers estimation. It also exposes `monitorGridState` — a reactive ref that updates when the monitor captures new data.

In `useElsaAutoOperation`, when `isEnabled` becomes true, watch `monitorGridState` (passed in from the parent or read from the shared monitor composable) and call `handleSubmit()` on change to trigger re-estimation automatically. Since `useElsaAutoOperation` only receives `expectedTotalPrice`, the auto-estimation trigger must be wired in `ElsaHeroPanel.vue` instead:

```javascript
// In ElsaHeroPanel.vue setup():
watch(isEnabled, (enabled) => {
  if (!enabled) return;
  // When auto-op is enabled, re-estimate whenever monitor data changes
  stopAutoEstimate = watch(estimator.monitorGridState, () => {
    estimator.handleSubmit();
  });
});
watch(isEnabled, (enabled) => {
  if (enabled) return;
  stopAutoEstimate?.();
  stopAutoEstimate = null;
});
```

If `handleSubmit` is a no-op when inputs are empty or invalid, no guard is needed.

### 2.4 Price watcher in `useElsaAutoOperation`

Define `cmd` at composable scope (accessible to both the watcher and `runScript`):

```javascript
const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);
```

Add a watcher stop handle:

```javascript
let stopPriceWatcher = null;
```

In `enable()`, after `isEnabled.value = true`, start the watcher:

```javascript
stopPriceWatcher = watch(expectedTotalPrice, (price) => {
  const amount = Math.round(price) || 0;
  cmd('SetExpectedPrice', { price: amount })
    .then(() => addLog(`估价已更新: ${amount}`))
    .catch(e => addLog(`价格同步失败: ${e?.message || e}`, 'warn'));
}, { immediate: true });
```

`{ immediate: true }` ensures the current price is pushed to the agent before `AutoAuction` starts.

In `disable()`, before the existing cleanup:

```javascript
if (stopPriceWatcher) { stopPriceWatcher(); stopPriceWatcher = null; }
```

### 2.5 `runScript()` implementation

```javascript
async function runScript(signal) {
  if (signal.aborted) throw new Error('操作已取消');
  addLog('开始自动竞拍…');

  const result = await cmd('AutoAuction', { roomId: 101 });

  if (result?.ok === false) {
    throw new Error(result.error || '竞拍失败');
  }

  const rounds = result?.rounds ?? 0;
  const price  = result?.expectedPrice ?? 0;
  addLog(`竞拍完成，共出价 ${rounds} 轮，使用估价 ${price}`);
}
```

`signal.aborted` check at the top handles the case where stop is pressed before `AutoAuction` is even called (the IPC call itself is not cancellable mid-flight).

### 2.6 Auto-disable after script completes

Change the `runScript` invocation in `enable()` from fire-and-forget to auto-disable on completion:

```javascript
// Before:
runScript(controller.signal).catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'));

// After:
runScript(controller.signal)
  .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
  .finally(() => disable());
```

This ensures `isEnabled` returns to false and the price watcher is torn down after the auction ends (success, error, or abort).

### 2.7 Log messages (hardcoded, not i18n'd)

| Situation | Level | Message |
|-----------|-------|---------|
| Script starts | info | `'开始自动竞拍…'` |
| Price synced to agent | info | `'估价已更新: {amount}'` |
| Price sync failed | warn | `'价格同步失败: {error}'` |
| Auction complete | info | `'竞拍完成，共出价 N 轮，使用估价 P'` |
| Script error (caught by finally) | error | `'脚本异常: {error}'` |

---

## What is NOT in scope

- Changing `roomId` from 101 (hardcoded for now)
- Looping across multiple auctions
- UI changes to `ElsaAutoOperationPanel.vue`
- i18n for any of the new log strings
- Cancelling an in-flight `AutoAuction` IPC call (stop button aborts before the call or after it returns)
