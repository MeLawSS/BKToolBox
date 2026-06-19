# Elsa Auto Auction Bidding Design

**Goal:** Implement the actual bidding script inside the Elsa auto-operation mode. When enabled, the script syncs the current Elsa expected price to the agent and runs one full automated auction session using per-round bid multipliers.

**Architecture:** Two coordinated changes — DLL side adds `SetExpectedPrice` command and modifies `AutoAuction` to use a stored global price with per-round multipliers; app side adds a price watcher that pushes price updates to the agent and triggers automatic re-estimation whenever monitor data changes.

**Tech Stack:** C++ (DLL, `MetaOperations.cpp`, `AggregateOperationSemantics.h`), Vue 3 Composition API (`useElsaAutoOperation.js`)

## Global Constraints

- No TypeScript — plain `.js` / `.vue` files
- Vue 3 `<script setup>` style throughout
- Activity log message strings in `useElsaAutoOperation.js` are hardcoded (not i18n'd) — this is an explicit exception per the existing spec
- `AutoAuction` `bidAmount` parameter is preserved for backward compatibility: if provided and non-zero, use it as a fixed bid amount (existing behavior); if absent or zero, use `g_expectedPrice` with per-round multipliers
- DLL global state uses `std::atomic<int>` for thread safety
- App-side price watcher is active only while `isEnabled` is true; it is set up in `enable()` and torn down in `disable()`
- `runScript` runs `AutoAuction` exactly once per enable — no loop
- The script ends (and `isEnabled` becomes false) when `AutoAuction` returns, whether success or error

---

## Part 1: DLL Side (`MetaOperations.cpp`, `AggregateOperationSemantics.h`)

### 1.1 New global: `g_expectedPrice`

Add a file-scope atomic int in `MetaOperations.cpp`:

```cpp
static std::atomic<int> g_expectedPrice{0};
```

### 1.2 New command: `SetExpectedPrice`

```
Command: SetExpectedPrice
Params:  { "price": <int> }   — non-negative integer
Returns: { "ok": true, "price": <n> }
```

Implementation: parse `price` from JSON, clamp to `[0, INT_MAX]`, store in `g_expectedPrice`, respond with the stored value.

Register in the command table (`BKAutoOpAgent.cpp`) alongside the other meta-ops.  
Declare in `MetaOperations.h`.

### 1.3 New pure function: `ComputeBidAmount`

Add to `AggregateOperationSemantics.h` (pure, inline, unit-testable):

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
- expectedPrice=0 → 0 for any round
- expectedPrice=10000, round 0 → 20000
- expectedPrice=10000, round 1 → 17000
- expectedPrice=10000, round 2 → 10000
- expectedPrice=10000, round 5 → 10000

### 1.4 Modify `CmdAutoAuction`

When `bidAmount` param is absent or zero, read `g_expectedPrice` each round and call `ComputeBidAmount(g_expectedPrice, roundsPlayed)` to get the actual amount. If `ComputeBidAmount` returns 0 (expected price not set), skip bidding for that round (do not call `PlaceBid`).

The per-round amount is computed fresh on each round entry so that `SetExpectedPrice` updates mid-auction take effect on subsequent rounds.

Add `"expectedPrice"` field to the success response:

```json
{ "result": "auction_ended", "rounds": <n>, "expectedPrice": <last value read> }
```

---

## Part 2: App Side (`useElsaAutoOperation.js`)

### 2.1 Auto-estimation on data change

When `enable()` succeeds, the Elsa estimator must run automatically whenever the underlying monitor data changes — no manual trigger required. When `disable()` is called, revert to manual-only mode.

The Elsa estimator is currently driven by `useHeroEstimatorPanel.js`. Inspect that composable to find:
- The reactive data source it reads (likely monitor capture data or a derived ref)
- Whether estimation is already reactive or requires an explicit `compute()` call

If estimation is already reactive (i.e., `expectedPrice` updates automatically when data changes), this section requires no extra code — the price watcher in 2.2 is sufficient. If it requires an explicit trigger, add a `watch` in `enable()` that calls it, and stop the watch in `disable()`.

### 2.2 Price watcher: sync to agent

Separately, watch the Elsa composable's `expectedPrice` (or equivalent output ref). Whenever it changes while `isEnabled` is true, call:

```javascript
await cmd('SetExpectedPrice', { price: expectedPrice.value });
```

This is fire-and-forget (don't `await` in the watcher body — use `.catch(e => addLog(...))` to avoid blocking).

### 2.3 `runScript()` implementation

```javascript
async function runScript(signal) {
  addLog('开始自动竞拍…');
  checkAbort(signal);

  const result = await cmd('AutoAuction', { roomId: 101 });

  if (result?.ok === false) {
    throw new Error(result.error || '竞拍失败');
  }

  const rounds = result?.rounds ?? 0;
  const price  = result?.expectedPrice ?? 0;
  addLog(`竞拍完成，共出价 ${rounds} 轮，使用估价 ${price}`);
}
```

`cmd` is `(name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args)`.  
`checkAbort(signal)` throws if the AbortController was triggered (stop button pressed).  
After `runScript` resolves or rejects, the existing `finally` block in `start()` sets `isEnabled = false`.

### 2.4 Log messages (hardcoded, not i18n'd)

| Situation | Level | Message |
|-----------|-------|---------|
| Script starts | info | `'开始自动竞拍…'` |
| Auction complete | info | `'竞拍完成，共出价 N 轮，使用估价 P'` |
| Auction error | error | `'竞拍失败: {error}'` (from existing `catch` in `start()`) |
| SetExpectedPrice error | warn | `'价格同步失败: {error}'` |
| Price updated | info | `'估价已更新: {price}'` |

---

## What is NOT in scope

- Changing roomId from 101 (hardcoded for now)
- Looping across multiple auctions
- UI changes to `ElsaAutoOperationPanel.vue` — existing panel is sufficient
- i18n for any of the new log strings
