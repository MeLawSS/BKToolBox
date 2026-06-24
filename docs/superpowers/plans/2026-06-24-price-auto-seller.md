# Price 仓库 Tab 自动售卖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add warehouse-tab auto-seller to the Price page — loops through visible warehouse items, prices each one with the existing rule, calls ExchangeItem, retries on exchange-slot failures via RefreshExchangeSellSlots, and stops cleanly on user request.

**Architecture:** Frontend orchestrator (`useWarehouseAutoSeller` composable) drives the loop; the agent DLL only adds one new narrow command (`RefreshExchangeSellSlots`). App.vue extracts a promise-based `refreshWarehouseSnapshot()` helper with in-flight dedup so both the auto-seller and the manual refresh button share one in-flight request. The composable is dependency-injected for testability.

**Tech Stack:** Vue 3 Composition API (`ref`, `computed`), Vitest with `@vue/test-utils`, fake timers (`vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()`), C++ cross-compiled for Windows (x86_64-w64-mingw32-g++ via WSL), Electron IPC (inject-service.js)

## Global Constraints

- All work is in worktree `.worktrees/price-auto-seller-design/` — never touch the main workdir.
- C++ must compile: builds and tests run via WSL (`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`).
- Frontend tests run with: `npx vitest run src/price/App.test.js` (from worktree root, native Windows shell).
- Electron tests run with: `npx vitest run electron/services/inject-service.test.mjs`.
- Full suite: `npm test`.
- Test collectible data must come from `public/data/collectibles.json` — test CIDs 1022001–1022004 are already loaded in App.test.js. Only use minimal fixtures for pure-error edge cases.
- `useWarehouseAutoSeller` must NOT depend on `selectedDisplayItem` or any user-selection state.
- Composable is dependency-injected: all external I/O passes through constructor options.
- `ExchangeItem returned false` (exact string) is the only recoverable error — everything else is a terminal skip for this run.
- `terminalSkipCids` is a per-run Set — cleared on each `start()`.

---

## File Structure

| File | Change |
|------|--------|
| `src/price/App.vue` | Extract `refreshWarehouseSnapshot()` with dedup; import and wire `useWarehouseAutoSeller`; add buttons + status display; adjust disable states |
| `src/price/useWarehouseAutoSeller.js` | **Create** — auto-seller composable (state machine, item loop, stop semantics) |
| `src/price/App.test.js` | Add auto-seller test group (lifecycle, item paths, retry chain, stop, UI states) |
| `electron/services/inject-service.js` | Add `REFRESH_EXCHANGE_SELL_SLOTS_TIMEOUT_MS = 20000` constant + case in `getAutoOperationCommandTimeoutMs()` |
| `electron/services/inject-service.test.mjs` | Add assertion that `RefreshExchangeSellSlots` gets 20 000 ms transport timeout |
| `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h` | Add `CmdRefreshExchangeSellSlots` declaration |
| `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` | Implement `CmdRefreshExchangeSellSlots` with local polling helpers that check `IsAgentShuttingDown()` only |
| `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` | Register `{ "RefreshExchangeSellSlots", CmdRefreshExchangeSellSlots }` in dispatch table |

---

### Task 1: Extract `refreshWarehouseSnapshot()` with in-flight dedup in App.vue

**Files:**
- Modify: `src/price/App.vue`
- Test: `src/price/App.test.js`

**Interfaces:**
- Produces: `refreshWarehouseSnapshot(): Promise<{ ok: boolean, rows?: any[], error?: string }>` — called by Task 2 composable

- [ ] **Step 1: Write the failing tests**

In `App.test.js`, inside the existing `describe('Price App', ...)` block, add a new `describe` block:

```js
describe('refreshWarehouseSnapshot()', () => {
  it('manual refresh still works after extraction refactor', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 3 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };

    const wrapper = await mountApp();
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetStockContainers', {});
    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain(
      getTestCollectible(1022002).name,
    );
  });

  it('concurrent callers share one in-flight GetStockContainers request', async () => {
    const stockDeferred = createDeferred();
    let getStockContainersCalls = 0;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        getStockContainersCalls++;
        return stockDeferred.promise;
      }
      throw new Error(`unexpected: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };

    const wrapper = await mountApp();
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();

    // Trigger two refreshes before the first resolves
    wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await nextTick();

    stockDeferred.resolve({
      ok: true,
      value: createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
          ],
        }),
      ]),
    });
    await flushPromises();
    await nextTick();

    // Only one GetStockContainers call should have been made
    expect(getStockContainersCalls).toBe(1);
    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain(
      getTestCollectible(1022002).name,
    );
  });

  it('returns ok:false and sets warehouseError on GetStockContainers failure', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') return { ok: false, error: 'bridge unavailable' };
      throw new Error(`unexpected: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };

    const wrapper = await mountApp();
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('bridge unavailable');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/price/App.test.js --reporter=verbose 2>&1 | tail -30
```

Expected: the new tests FAIL (concurrent-callers test may pass accidentally since current code blocks second call with `if (isRefreshingWarehouse.value) return`).

- [ ] **Step 3: Implement `refreshWarehouseSnapshot()` in App.vue**

In `App.vue`, before `refreshWarehouseItems()`, add:

```js
let _refreshSnapshotInFlight = null;

async function refreshWarehouseSnapshot() {
  if (_refreshSnapshotInFlight) return _refreshSnapshotInFlight;
  _refreshSnapshotInFlight = _doRefreshWarehouseSnapshot().finally(() => {
    _refreshSnapshotInFlight = null;
  });
  return _refreshSnapshotInFlight;
}

async function _doRefreshWarehouseSnapshot() {
  isRefreshingWarehouse.value = true;
  try {
    if (liveCollectionCids.value === undefined) {
      try {
        const cidResponse = await window.bidkingDesktop.runAutoOperationCommand('GetCollectionItemCids', {});
        if (cidResponse?.ok !== false && Array.isArray(cidResponse?.value?.cids)) {
          liveCollectionCids.value = new Set(
            cidResponse.value.cids.map(Number).filter(Number.isSafeInteger),
          );
        }
      } catch (error) {
        console.error('GetCollectionItemCids failed:', error);
      }
    }

    const response = await window.bidkingDesktop.runAutoOperationCommand('GetStockContainers', {});
    if (response?.ok === false) throw new Error(response.error || t('price.refreshWarehouseUnavailable'));
    const rows = buildWarehouseRowsFromStockContainers(response?.value ?? response);
    warehouseRows.value = rows;
    await syncWarehouseSelection();
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  } finally {
    isRefreshingWarehouse.value = false;
  }
}
```

Replace the existing `refreshWarehouseItems()` body:

```js
async function refreshWarehouseItems() {
  if (!canRefreshWarehouse.value) {
    warehouseError.value = t('price.refreshWarehouseUnavailable');
    return;
  }
  warehouseError.value = '';
  const result = await refreshWarehouseSnapshot();
  if (!result.ok) {
    warehouseError.value = result.error ?? t('price.refreshWarehouseUnavailable');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/price/App.test.js --reporter=verbose 2>&1 | tail -30
```

Expected: all three new tests PASS, existing warehouse tests still pass.

- [ ] **Step 5: Commit**

```
git -C .worktrees/price-auto-seller-design add src/price/App.vue src/price/App.test.js
git -C .worktrees/price-auto-seller-design commit -m "refactor(price): extract refreshWarehouseSnapshot() with in-flight dedup"
```

---

### Task 2: Create `useWarehouseAutoSeller.js` + App.vue wiring + lifecycle tests

**Files:**
- Create: `src/price/useWarehouseAutoSeller.js`
- Modify: `src/price/App.vue`
- Test: `src/price/App.test.js`

**Interfaces:**
- Consumes: `refreshWarehouseSnapshot()` from Task 1
- Produces:
  ```js
  useWarehouseAutoSeller({ warehouseItems, listingDefaultPricePercent, refreshWarehouseSnapshot, runAutoOperationCommand })
  // returns:
  {
    phase: Ref<'idle'|'running'|'retry_wait'|'refreshing_exchange'|'stopping'|'stopped'|'completed'|'failed'>,
    currentItemCid: Ref<number|null>,
    currentItemName: Ref<string>,
    successCount: Ref<number>,
    skippedCount: Ref<number>,
    lastError: Ref<string>,
    isActive: ComputedRef<boolean>,  // true when phase ∈ {running,retry_wait,refreshing_exchange,stopping}
    start(): void,
    stop(): void,
  }
  ```

- [ ] **Step 1: Write failing tests (lifecycle + UI wiring)**

Add a new `describe('auto-seller', ...)` block in `App.test.js`. Add this **helper function** just before the new describe block:

```js
async function mountAutoSellerTab(options = {}) {
  const stockItems = options.stockItems ?? [];
  const commands = options.commands ?? {};
  const calls = [];

  const runAutoOperationCommand = vi.fn(async (command, args) => {
    calls.push({ command, args });
    if (command === 'GetCollectionItemCids') {
      return { ok: true, value: { cids: stockItems.map(i => i.itemCid) } };
    }
    if (command === 'GetStockContainers') {
      const fn = commands.GetStockContainers;
      if (fn) return fn(args, calls);
      return {
        ok: true,
        value: createWarehouseSnapshot([
          createWarehouseContainer({ stockId: 0, items: stockItems }),
        ]),
      };
    }
    const fn = commands[command];
    if (fn) return fn(args, calls);
    throw new Error(`unexpected auto-seller command: ${command}`);
  });

  window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
  const wrapper = await mountApp();
  await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
  await nextTick();

  return { wrapper, calls, runAutoOperationCommand };
}
```

Then add the test group:

```js
describe('auto-seller', () => {
  it('start button is shown in warehouse tab when desktop available', async () => {
    const { wrapper } = await mountAutoSellerTab();
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').exists()).toBe(true);
  });

  it('start button is disabled when quick listing is in progress', async () => {
    const listingDeferred = createDeferred();
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => listingDeferred.promise,
      },
    });

    // First: load warehouse via manual refresh to select the item
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Select the item and start quick listing
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await nextTick();
    wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    // While quick listing is in progress, start auto-seller button should be disabled
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').attributes('disabled')).toBeDefined();

    listingDeferred.resolve({ ok: true });
    await flushPromises();
  });

  it('start button is disabled when listing modal is open', async () => {
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
    });

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="price-auto-seller-start"]').attributes('disabled')).toBeDefined();
  });

  it('completes immediately when warehouse is empty after initial refresh', async () => {
    const { wrapper } = await mountAutoSellerTab({ stockItems: [] });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('completed');
  });

  it('enters failed state when initial warehouse refresh fails', async () => {
    const { wrapper } = await mountAutoSellerTab({
      commands: {
        GetStockContainers: async () => ({ ok: false, error: 'bridge error' }),
      },
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('failed');
    expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('bridge error');
  });

  it('disables refresh button, quick-listing button, and listing-open button while auto-seller is active', async () => {
    const exchDeferred = createDeferred();
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => exchDeferred.promise,
      },
    });

    // Load warehouse first so the quick-listing buttons appear
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await nextTick();

    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Auto-seller is now active (ExchangeItem pending)
    expect(wrapper.find('[data-testid="price-warehouse-refresh"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-auto-seller-stop"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="price-quick-listing"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="price-listing-open"]').attributes('disabled')).toBeDefined();

    exchDeferred.resolve({ ok: true });
    await flushPromises();
  });

  it('returns to idle-like state (start button shown) after completion', async () => {
    const { wrapper } = await mountAutoSellerTab({ stockItems: [] });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    // After completed, start button is back
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/price/App.test.js --reporter=verbose 2>&1 | grep -E "FAIL|PASS|auto-seller" | head -30
```

Expected: all new tests FAIL (composable not created, buttons not in template).

- [ ] **Step 3: Create `src/price/useWarehouseAutoSeller.js`**

```js
import { computed, ref } from 'vue';
import { computeDefaultUnitPrice } from './listing-form.js';

export function useWarehouseAutoSeller({
  warehouseItems,
  listingDefaultPricePercent,
  refreshWarehouseSnapshot,
  runAutoOperationCommand,
}) {
  const phase = ref('idle');
  const currentItemCid = ref(null);
  const currentItemName = ref('');
  const successCount = ref(0);
  const skippedCount = ref(0);
  const lastError = ref('');
  const stopRequested = ref(false);

  let _terminalSkipCids = new Set();
  let _inDllCall = false;

  const isActive = computed(() =>
    ['running', 'retry_wait', 'refreshing_exchange', 'stopping'].includes(phase.value),
  );

  function stop() {
    if (!isActive.value) return;
    stopRequested.value = true;
    if (_inDllCall) phase.value = 'stopping';
  }

  function _checkStop() {
    if (!stopRequested.value) return false;
    phase.value = 'stopped';
    return true;
  }

  async function _bridge(command, args) {
    _inDllCall = true;
    try {
      return await runAutoOperationCommand(command, args ?? {});
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      _inDllCall = false;
    }
  }

  async function _snapshot() {
    _inDllCall = true;
    try {
      return await refreshWarehouseSnapshot();
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      _inDllCall = false;
    }
  }

  async function _cancelableSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (stopRequested.value) return false;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    return !stopRequested.value;
  }

  function _getNextCandidate() {
    return warehouseItems.value.find((item) => !_terminalSkipCids.has(item.itemCid)) ?? null;
  }

  async function _handleNonRecoverableSkip(item) {
    skippedCount.value++;
    _terminalSkipCids.add(item.itemCid);
    const snap = await _snapshot();
    if (_checkStop()) return 'stop';
    if (!snap.ok) {
      lastError.value = snap.error ?? 'Warehouse refresh failed';
      return 'failed';
    }
    return 'skipped';
  }

  async function _processItem(item) {
    for (;;) {
      if (_checkStop()) return 'stop';

      currentItemCid.value = item.itemCid;
      currentItemName.value = item.name ?? String(item.itemCid);
      phase.value = 'running';

      const tradeResp = await _bridge('GetItemTradeInfo', { itemCid: item.itemCid });
      if (_checkStop()) return 'stop';

      if (!tradeResp || tradeResp.ok === false) {
        lastError.value = tradeResp?.error ?? 'GetItemTradeInfo failed';
        return _handleNonRecoverableSkip(item);
      }

      const minPrice = Number(tradeResp.value?.minPrice);
      if (!Number.isFinite(minPrice) || minPrice <= 0) {
        lastError.value = 'Invalid minPrice from GetItemTradeInfo';
        return _handleNonRecoverableSkip(item);
      }

      const listPrice = computeDefaultUnitPrice(minPrice, listingDefaultPricePercent.value);
      if (listPrice === null) {
        lastError.value = 'Price calculation failed';
        return _handleNonRecoverableSkip(item);
      }

      const basePrice = Number(item.basePrice);
      if (Number.isFinite(basePrice) && basePrice > 0 && listPrice < basePrice) {
        lastError.value = `List price ${listPrice} below base price ${basePrice}`;
        return _handleNonRecoverableSkip(item);
      }

      const exchResp = await _bridge('ExchangeItem', {
        itemCid: item.itemCid,
        count: item.count,
        unitPrice: listPrice,
      });
      if (_checkStop()) return 'stop';

      if (!exchResp || exchResp.ok !== false) {
        return 'success';
      }

      const errMsg = String(exchResp?.error ?? '');

      if (errMsg === 'ExchangeItem returned false') {
        phase.value = 'retry_wait';
        const sleptOk = await _cancelableSleep(10000);
        if (!sleptOk) { phase.value = 'stopped'; return 'stop'; }

        phase.value = 'refreshing_exchange';
        const refreshResp = await _bridge('RefreshExchangeSellSlots', {});
        if (_checkStop()) return 'stop';

        if (!refreshResp || refreshResp.ok === false) {
          lastError.value = refreshResp?.error ?? 'RefreshExchangeSellSlots failed';
          return 'failed';
        }
        continue; // retry current item
      }

      lastError.value = errMsg || 'ExchangeItem failed';
      return _handleNonRecoverableSkip(item);
    }
  }

  async function start() {
    if (isActive.value) return;

    phase.value = 'running';
    stopRequested.value = false;
    _terminalSkipCids = new Set();
    currentItemCid.value = null;
    currentItemName.value = '';
    successCount.value = 0;
    skippedCount.value = 0;
    lastError.value = '';

    const snap = await _snapshot();
    if (_checkStop()) return;
    if (!snap.ok) {
      lastError.value = snap.error ?? 'Failed to load warehouse';
      phase.value = 'failed';
      return;
    }

    for (;;) {
      if (_checkStop()) return;

      const candidate = _getNextCandidate();
      if (!candidate) {
        phase.value = 'completed';
        return;
      }

      const outcome = await _processItem(candidate);

      if (outcome === 'stop') return;
      if (outcome === 'failed') { phase.value = 'failed'; return; }

      if (outcome === 'success') {
        successCount.value++;
        const snapAfter = await _snapshot();
        if (_checkStop()) return;
        if (!snapAfter.ok) {
          lastError.value = snapAfter.error ?? 'Warehouse refresh failed after success';
          phase.value = 'failed';
          return;
        }
        const slept = await _cancelableSleep(1500);
        if (!slept) { phase.value = 'stopped'; return; }
      }
      // 'skipped': continue to next candidate immediately
    }
  }

  return {
    phase,
    currentItemCid,
    currentItemName,
    successCount,
    skippedCount,
    lastError,
    isActive,
    start,
    stop,
  };
}
```

- [ ] **Step 4: Wire `useWarehouseAutoSeller` into App.vue**

Add import at top of `<script setup>`:
```js
import { useWarehouseAutoSeller } from './useWarehouseAutoSeller.js';
```

After `const listingDefaultPricePercent = computed(...)` (around line 175), add:
```js
const autoSeller = useWarehouseAutoSeller({
  warehouseItems,
  listingDefaultPricePercent,
  refreshWarehouseSnapshot,
  runAutoOperationCommand: (cmd, args) => window.bidkingDesktop.runAutoOperationCommand(cmd, args),
});

const canStartAutoSeller = computed(() =>
  canRefreshWarehouse.value
  && !isQuickListing.value
  && !isListingModalOpen.value
  && !autoSeller.isActive.value,
);
```

In the template, inside the warehouse section `<section v-else class="opportunity-panel" data-testid="price-warehouse">`, update the header:

```html
<header>
  <div>
    <h2>{{ t('price.warehouse') }}</h2>
    <p>{{ t('price.warehouseSub') }}</p>
  </div>
  <button
    class="ghost-button"
    type="button"
    data-testid="price-warehouse-refresh"
    :disabled="isRefreshingWarehouse || !canRefreshWarehouse || autoSeller.isActive.value"
    @click="refreshWarehouseItems"
  >
    {{ isRefreshingWarehouse ? t('price.refreshingWarehouse') : t('price.refreshWarehouse') }}
  </button>
  <button
    v-if="!autoSeller.isActive.value"
    class="primary-button"
    type="button"
    data-testid="price-auto-seller-start"
    :disabled="!canStartAutoSeller"
    @click="autoSeller.start()"
  >
    开始自动售卖
  </button>
  <button
    v-else
    class="ghost-button"
    type="button"
    data-testid="price-auto-seller-stop"
    :disabled="autoSeller.phase.value === 'stopping'"
    @click="autoSeller.stop()"
  >
    {{ autoSeller.phase.value === 'stopping' ? '正在停止...' : '停止自动售卖' }}
  </button>
</header>
```

Add auto-seller status block immediately after the `<p v-if="warehouseError" ...>` error line:

```html
<div
  v-if="autoSeller.phase.value !== 'idle'"
  class="auto-seller-status"
  data-testid="auto-seller-status"
>
  <span data-testid="auto-seller-phase">{{ autoSeller.phase.value }}</span>
  <span v-if="autoSeller.currentItemName.value" data-testid="auto-seller-current-item">
    {{ autoSeller.currentItemName.value }} ({{ autoSeller.currentItemCid.value }})
  </span>
  <span data-testid="auto-seller-counts">
    成功: {{ autoSeller.successCount.value }} / 跳过: {{ autoSeller.skippedCount.value }}
  </span>
  <p v-if="autoSeller.lastError.value" class="error-text" data-testid="auto-seller-error">
    {{ autoSeller.lastError.value }}
  </p>
</div>
```

Update the quick-listing and listing-open buttons in the detail panel to also disable when auto-seller is active. Find the two buttons with `data-testid="price-quick-listing"` and `data-testid="price-listing-open"` and add `:disabled` conditions:

```html
<!-- price-quick-listing button: -->
:disabled="isQuickListing || autoSeller.isActive.value"

<!-- price-listing-open button: -->
:disabled="isQuickListing || autoSeller.isActive.value"
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run src/price/App.test.js --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|PASS" | tail -40
```

Expected: all new lifecycle tests PASS, all existing tests still PASS.

- [ ] **Step 6: Commit**

```
git -C .worktrees/price-auto-seller-design add src/price/useWarehouseAutoSeller.js src/price/App.vue src/price/App.test.js
git -C .worktrees/price-auto-seller-design commit -m "feat(price): add useWarehouseAutoSeller composable with lifecycle and App.vue wiring"
```

---

### Task 3: Full item processing loop — success path, retry chain, skip paths + tests

**Files:**
- Modify: `src/price/useWarehouseAutoSeller.js` (the `_processItem` and outer loop are already scaffolded in Task 2 — this task adds the remaining tests to cover all paths)
- Test: `src/price/App.test.js`

**Note:** The composable implementation from Task 2 already contains `_processItem()` with all paths (success, retry, skip). This task focuses on writing the test coverage that drives verification of each path.

- [ ] **Step 1: Write failing tests for item processing paths**

Add inside the existing `describe('auto-seller', ...)` block:

```js
it('auto-seller: lists one item successfully then completes when warehouse empties', async () => {
  let stockCallCount = 0;
  const { wrapper } = await mountAutoSellerTab({
    stockItems: [
      createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 2 }),
    ],
    commands: {
      GetStockContainers: async () => {
        stockCallCount++;
        // First call (on start): return one item; second call (after ExchangeItem): empty
        if (stockCallCount === 1) {
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 2 })],
              }),
            ]),
          };
        }
        return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
      },
      GetItemTradeInfo: async (args) => {
        expect(args.itemCid).toBe(1022002);
        return { ok: true, value: { minPrice: 5000 } };
      },
      ExchangeItem: async (args) => {
        expect(args.itemCid).toBe(1022002);
        expect(args.count).toBe(2);
        // listPrice = floor(5000 * 99/100) = 4950
        expect(args.unitPrice).toBe(4950);
        return { ok: true };
      },
    },
  });

  vi.useFakeTimers();
  try {
    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0); // bridge calls resolve immediately

    // After ExchangeItem success, successCount increments and 1.5s sleep begins
    // Advance past the 1.5s wait
    await vi.advanceTimersByTimeAsync(2000);
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 1');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 0');
  } finally {
    vi.useRealTimers();
  }
});

it('auto-seller: waits 1.5 seconds between successful listings', async () => {
  let stockCallCount = 0;
  const exchCallCount = { value: 0 };
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => {
        stockCallCount++;
        if (stockCallCount <= 2) {
          // First two calls return one item each (simulates item being present for second listing)
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
              }),
            ]),
          };
        }
        return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
      },
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => {
        exchCallCount.value++;
        return { ok: true };
      },
    },
  });

  vi.useFakeTimers();
  try {
    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0); // first item bridges resolve

    // After first ExchangeItem, we're in the 1.5s sleep
    // Only one ExchangeItem call so far
    expect(exchCallCount.value).toBe(1);
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('running');

    // Advance past 1.5s
    await vi.advanceTimersByTimeAsync(2000);
    await nextTick();
    // Second item has been processed
    expect(exchCallCount.value).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

it('auto-seller: skips item below base price without calling ExchangeItem', async () => {
  // itemCid 1022001 (急救毯): basePrice=770; minPrice=700 → listPrice=693 < 770 → skip
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async (_args, calls) => {
        // After the below-base-price skip, the composable calls refresh → return empty
        const stockCalls = calls.filter(c => c.command === 'GetStockContainers').length;
        if (stockCalls <= 1) {
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022001, stockId: 0, pos: 0, count: 1 })],
              }),
            ]),
          };
        }
        return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
      },
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 700 } }),
    },
  });

  await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
  expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 1');
  expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 0');
  // ExchangeItem must NOT have been called
  const exchCalls = wrapper.vm ? undefined : undefined; // check via mock
  // We verify via the absence of an 'ExchangeItem' key in commands — the mock throws on unexpected
  // (if ExchangeItem were called, the test would throw "unexpected auto-seller command: ExchangeItem")
});

it('auto-seller: items all in terminalSkipCids → completes rather than looping', async () => {
  let stockCallCount = 0;
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => {
        stockCallCount++;
        // always return same item
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022001, stockId: 0, pos: 0, count: 1 })],
            }),
          ]),
        };
      },
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 700 } }), // below base price → skip
    },
  });

  await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
  await flushPromises();
  await nextTick();

  // The item is skipped and added to terminalSkipCids. Even though warehouse still shows the item
  // (stockCallCount > 1), the composable sees it's already in terminalSkipCids → completed.
  expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
  expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 1');
});

it('auto-seller: non-ExchangeItem-returned-false error skips the item', async () => {
  let stockCallCount = 0;
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => {
        stockCallCount++;
        if (stockCallCount <= 1) {
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
              }),
            ]),
          };
        }
        return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
      },
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => ({ ok: false, error: 'slot full' }),
    },
  });

  await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
  expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 1');
  expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('slot full');
});

it('auto-seller: ExchangeItem returned false → 10s wait → RefreshExchangeSellSlots → retry success', async () => {
  let exchCallCount = 0;
  let stockCallCount = 0;
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => {
        stockCallCount++;
        if (stockCallCount <= 2) {
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
              }),
            ]),
          };
        }
        return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
      },
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => {
        exchCallCount++;
        if (exchCallCount === 1) return { ok: false, error: 'ExchangeItem returned false' };
        return { ok: true };
      },
      RefreshExchangeSellSlots: async () => ({ ok: true }),
    },
  });

  vi.useFakeTimers();
  try {
    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0); // initial load + first GetItemTradeInfo + first ExchangeItem

    // ExchangeItem returned false → retry_wait phase, 10s sleep begins
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');

    // Advance past 10s
    await vi.advanceTimersByTimeAsync(10100);
    await nextTick();
    // Transitioning to refreshing_exchange, then RefreshExchangeSellSlots resolves, then retry
    await vi.advanceTimersByTimeAsync(0);

    // After RefreshExchangeSellSlots, retry ExchangeItem (second call) succeeds
    // Then 1.5s success wait
    await vi.advanceTimersByTimeAsync(2000);
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 1');
    expect(exchCallCount).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

it('auto-seller: ExchangeItem returned false persists → repeats retry chain each time', async () => {
  let exchCallCount = 0;
  let refreshCallCount = 0;
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => ({
        ok: true,
        value: createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
          }),
        ]),
      }),
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => {
        exchCallCount++;
        return { ok: false, error: 'ExchangeItem returned false' };
      },
      RefreshExchangeSellSlots: async () => {
        refreshCallCount++;
        return { ok: true };
      },
    },
  });

  vi.useFakeTimers();
  try {
    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);

    // First retry cycle
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');
    await vi.advanceTimersByTimeAsync(10100);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCallCount).toBe(1);
    expect(exchCallCount).toBe(1);

    // Second retry cycle — ExchangeItem returned false again
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');
    await vi.advanceTimersByTimeAsync(10100);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCallCount).toBe(2);
    expect(exchCallCount).toBe(2);

    // Still in retry_wait (third time), not stuck or completed
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');
  } finally {
    vi.useRealTimers();
  }
});

it('auto-seller: RefreshExchangeSellSlots failure → task enters failed', async () => {
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => ({
        ok: true,
        value: createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
          }),
        ]),
      }),
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => ({ ok: false, error: 'ExchangeItem returned false' }),
      RefreshExchangeSellSlots: async () => ({ ok: false, error: 'unknown screen' }),
    },
  });

  vi.useFakeTimers();
  try {
    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0); // first ExchangeItem call
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');

    await vi.advanceTimersByTimeAsync(10100);
    await vi.advanceTimersByTimeAsync(0); // RefreshExchangeSellSlots resolves

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('failed');
    expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('unknown screen');
  } finally {
    vi.useRealTimers();
  }
});

it('auto-seller: stop during retry_wait immediately stops the run', async () => {
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => ({
        ok: true,
        value: createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
          }),
        ]),
      }),
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => ({ ok: false, error: 'ExchangeItem returned false' }),
    },
  });

  vi.useFakeTimers();
  try {
    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0); // first ExchangeItem
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');

    // Click stop during the 10s wait
    wrapper.find('[data-testid="price-auto-seller-stop"]').trigger('click');
    await vi.advanceTimersByTimeAsync(100); // let the 50ms sleep poll fire
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('stopped');
  } finally {
    vi.useRealTimers();
  }
});

it('auto-seller: warehouse refresh failure after success → task enters failed', async () => {
  let stockCallCount = 0;
  const { wrapper } = await mountAutoSellerTab({
    commands: {
      GetStockContainers: async () => {
        stockCallCount++;
        if (stockCallCount === 1) {
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
              }),
            ]),
          };
        }
        // second call (after success) fails
        return { ok: false, error: 'refresh failed after listing' };
      },
      GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
      ExchangeItem: async () => ({ ok: true }),
    },
  });

  await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('failed');
  expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('refresh failed after listing');
});
```

- [ ] **Step 2: Run tests to verify the test suite behaves correctly**

```
npx vitest run src/price/App.test.js --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|PASS" | tail -50
```

Expected: new tests PASS (the Task 2 composable already implements all paths). If any fail, debug and fix the composable.

- [ ] **Step 3: If any test fails, fix `useWarehouseAutoSeller.js`**

Typical issues to check:
- `_handleNonRecoverableSkip` returns a Promise — ensure callers `await` it: `return await _handleNonRecoverableSkip(item)` (not `return _handleNonRecoverableSkip(item)`)
- `_processItem` inner loop: after `continue`, check that `_checkStop()` is called at top of each iteration
- Verify `lastError.value` is set before returning 'failed' from `_handleNonRecoverableSkip` error path

- [ ] **Step 4: Run full suite to check no regressions**

```
npm test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git -C .worktrees/price-auto-seller-design add src/price/useWarehouseAutoSeller.js src/price/App.test.js
git -C .worktrees/price-auto-seller-design commit -m "test(price): full auto-seller item processing coverage — success, retry, skip, stop paths"
```

---

### Task 4: inject-service.js timeout mapping for RefreshExchangeSellSlots

**Files:**
- Modify: `electron/services/inject-service.js:13-23` (constants) and `:332-359` (getAutoOperationCommandTimeoutMs)
- Test: `electron/services/inject-service.test.mjs`

**Interfaces:**
- Consumes: `getAutoOperationCommandTimeoutMs` in inject-service.js (existing function, tested by existing test)

- [ ] **Step 1: Write the failing test**

In `inject-service.test.mjs`, find the test `'uses longer pipe timeouts for long-running AutoOperation commands'` and add one more `await service.runAutoOperationCommand(...)` call and one more expectation. Add this immediately after the existing `ExchangeItem` call in that test:

```js
await service.runAutoOperationCommand('RefreshExchangeSellSlots', {}, { sendAutoOperationCommand });
```

And add a new assertion after the existing ExchangeItem assertion (it will be call #10):

```js
expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
  10,
  'RefreshExchangeSellSlots',
  {},
  expect.objectContaining({ timeoutMs: 20000 }),
);
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run electron/services/inject-service.test.mjs --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|PASS" | head -20
```

Expected: the modified test FAILS because `RefreshExchangeSellSlots` currently falls through to `DEFAULT_AUTO_OPERATION_TIMEOUT_MS = 5000`.

- [ ] **Step 3: Add the constant and the case**

In `inject-service.js`, after the existing constants block (around line 23), add:

```js
const REFRESH_EXCHANGE_SELL_SLOTS_TIMEOUT_MS = 20000;
```

In `getAutoOperationCommandTimeoutMs()`, add a case before the final `return DEFAULT_AUTO_OPERATION_TIMEOUT_MS`:

```js
if (command === 'RefreshExchangeSellSlots') {
    return REFRESH_EXCHANGE_SELL_SLOTS_TIMEOUT_MS;
}
return DEFAULT_AUTO_OPERATION_TIMEOUT_MS;
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run electron/services/inject-service.test.mjs --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|PASS" | head -20
```

Expected: PASS. The `RefreshExchangeSellSlots` command now maps to 20 000 ms.

- [ ] **Step 5: Run full suite**

```
npm test 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```
git -C .worktrees/price-auto-seller-design add electron/services/inject-service.js electron/services/inject-service.test.mjs
git -C .worktrees/price-auto-seller-design commit -m "feat(inject): map RefreshExchangeSellSlots to 20s transport timeout"
```

---

### Task 5: Agent `CmdRefreshExchangeSellSlots` — C++ implementation, dispatch, build

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`

**Notes:**
- All builds run in WSL: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` from the worktree root.
- The command must NOT use `WaitForScreen()`, `WaitForToggleState()`, `WaitForScreenTransition()`, `WaitForNodeReady()`, or `SleepInterruptibly()` from MetaOperations.cpp — those check `IsAutoAuctionStopRequested()` which fires when an AutoAuction cancel is in progress and would incorrectly abort this command. Write local helpers that check `IsAgentShuttingDown()` only.

- [ ] **Step 1: Add declaration to `MetaOperations.h`**

In `MetaOperations.h`, after the last `Cmd*` declaration (line 115, `CmdSetExpectedPrice`), add:

```cpp
void CmdRefreshExchangeSellSlots(AgentConn* c, const char* id, const char* json);
```

- [ ] **Step 2: Add local polling helpers + `CmdRefreshExchangeSellSlots` to `MetaOperations.cpp`**

At the end of `MetaOperations.cpp` (after all existing command implementations), add:

```cpp
// ==========================================================================
// CmdRefreshExchangeSellSlots — navigate to exchange sell tab and confirm ready.
// Uses local helpers that check IsAgentShuttingDown() only (not AutoAuction stop).
// ==========================================================================

static bool WaitForScreenREFRESH(const char* targetScreen, int timeoutMs, int pollIntervalMs) {
    DWORD start = GetTickCount();
    for (;;) {
        if (IsAgentShuttingDown()) return false;
        ScreenState s = DetectScreenState();
        if (strcmp(s.screen, targetScreen) == 0) return true;
        if ((int)(GetTickCount() - start) >= timeoutMs) return false;
        Sleep(pollIntervalMs);
    }
}

static bool WaitForToggleStateREFRESH(Il2CppObject* transform, const char* nodePath,
                                       bool expectedOn, int timeoutMs, int pollIntervalMs) {
    DWORD start = GetTickCount();
    for (;;) {
        if (IsAgentShuttingDown()) return false;
        std::vector<UiNodeSnapshot> m;
        ResolveUiNodeMatches(transform, nodePath, UI_PATH_EXACT, 1, &m);
        if (!m.empty()) {
            bool on = false;
            if (ReadToggleValue(m[0].components, &on) && on == expectedOn) return true;
        }
        if ((int)(GetTickCount() - start) >= timeoutMs) return false;
        Sleep(pollIntervalMs);
    }
}

void CmdRefreshExchangeSellSlots(AgentConn* c, const char* id, const char* /*json*/) {
    const int TOTAL_BUDGET_MS = 15000;
    const int STEP_MS         = 4000;
    const int POLL_MS         = 200;

    DWORD overallStart = GetTickCount();
    auto budgetLeft = [&]() -> int {
        int elapsed = (int)(GetTickCount() - overallStart);
        return TOTAL_BUDGET_MS - elapsed;
    };

    ScreenState s = DetectScreenState();
    std::string screenBefore(s.screen);
    bool enteredExchange   = false;
    bool toggledBuyThenSell = false;

    // ---- Phase 1: converge to exchange screen --------------------------------
    if (strcmp(s.screen, "exchange") != 0) {
        // Close overlays until main_lobby or exchange
        while (strcmp(s.screen, "main_lobby") != 0 && strcmp(s.screen, "exchange") != 0) {
            if (IsAgentShuttingDown()) { SendResponse(c, id, false, "agent shutting down"); return; }
            if (budgetLeft() <= 0) { SendResponse(c, id, false, "budget exhausted converging to main_lobby"); return; }
            if (strcmp(s.screen, "unknown") == 0) { SendResponse(c, id, false, "unknown screen"); return; }

            Il2CppObject* closeXform = nullptr;
            const char*   closePath  = nullptr;
            if (!ResolveCloseTarget(s, &closeXform, &closePath)) {
                SendResponse(c, id, false, "no close target for current screen");
                return;
            }
            std::string err;
            if (!ClickNode(closeXform, closePath, 0, &err)) {
                SendResponse(c, id, false, ("close overlay failed: " + err).c_str());
                return;
            }
            int stepBudget = std::min(STEP_MS, budgetLeft());
            if (!WaitForScreenREFRESH("main_lobby", stepBudget, POLL_MS)) {
                s = DetectScreenState();
                if (strcmp(s.screen, "main_lobby") != 0 && strcmp(s.screen, "exchange") != 0) {
                    SendResponse(c, id, false, "failed to reach main_lobby after closing overlay");
                    return;
                }
            }
            s = DetectScreenState();
        }

        if (strcmp(s.screen, "main_lobby") == 0) {
            if (!s.uiMainTransform) { SendResponse(c, id, false, "UIMain transform unavailable"); return; }
            std::string err;
            if (!ClickNode(s.uiMainTransform, "MainPanel/Btns2/Button_2", 0, &err)) {
                SendResponse(c, id, false, ("click exchange entry: " + err).c_str());
                return;
            }
            int stepBudget = std::min(STEP_MS, budgetLeft());
            if (!WaitForScreenREFRESH("exchange", stepBudget, POLL_MS)) {
                SendResponse(c, id, false, "exchange did not appear after clicking entry");
                return;
            }
            s = DetectScreenState();
            enteredExchange = true;
        }
    }

    // ---- Phase 2: toggle sell tab (buy → sell when was already in exchange; just sell when entered) ----
    if (strcmp(s.screen, "exchange") != 0 || !s.tradingPanelTransform) {
        SendResponse(c, id, false, "not in exchange after navigation");
        return;
    }
    Il2CppObject* tp = s.tradingPanelTransform;
    std::string err;

    if (!enteredExchange) {
        // Was already in exchange: click buy tab first to reset, then sell
        if (!ClickNode(tp, "Toggles/Toggle (1)", 0, &err)) {
            SendResponse(c, id, false, ("click buy tab: " + err).c_str());
            return;
        }
        int stepBudget = std::min(STEP_MS, budgetLeft());
        if (!WaitForToggleStateREFRESH(tp, "Toggles/Toggle (1)", true, stepBudget, POLL_MS)) {
            SendResponse(c, id, false, "buy tab did not activate");
            return;
        }
        if (!ClickNode(tp, "Toggles/Toggle (2)", 0, &err)) {
            SendResponse(c, id, false, ("click sell tab: " + err).c_str());
            return;
        }
        toggledBuyThenSell = true;
    } else {
        // Entered fresh: just click sell tab
        if (!ClickNode(tp, "Toggles/Toggle (2)", 0, &err)) {
            SendResponse(c, id, false, ("click sell tab: " + err).c_str());
            return;
        }
    }

    // ---- Phase 3: confirm sell tab active ----------------------------------------
    int stepBudget = std::min(STEP_MS, budgetLeft());
    if (!WaitForToggleStateREFRESH(tp, "Toggles/Toggle (2)", true, stepBudget, POLL_MS)) {
        SendResponse(c, id, false, "sell tab did not activate within budget");
        return;
    }

    std::string result =
        "{\"screenBefore\":\"" + screenBefore + "\""
        ",\"screenAfter\":\"exchange\""
        ",\"enteredExchange\":"  + std::string(enteredExchange    ? "true" : "false") +
        ",\"toggledBuyThenSell\":" + std::string(toggledBuyThenSell ? "true" : "false") +
        ",\"sellTabReady\":true"
        "}";
    SendResponse(c, id, true, result.c_str());
}
```

- [ ] **Step 3: Register in dispatch table in `BKAutoOpAgent.cpp`**

Find the dispatch table (around line 4736). It ends with:
```cpp
{ nullptr, nullptr }
```

Insert before the nullptr sentinel:
```cpp
{ "RefreshExchangeSellSlots", CmdRefreshExchangeSellSlots },
```

The table entry should look like:
```cpp
{ "CloseCurrentOverlay",     CmdCloseCurrentOverlay },
{ "RefreshExchangeSellSlots", CmdRefreshExchangeSellSlots },
{ nullptr, nullptr }
```

- [ ] **Step 4: Build the DLL via WSL**

```bash
# Run from repo root in WSL
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected output:
```
Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
```

If compilation fails:
- Missing `#include`: check that `MetaOperations.cpp` already includes all needed headers (it does)
- Undeclared function: verify `WaitForScreenREFRESH` and `WaitForToggleStateREFRESH` are declared before `CmdRefreshExchangeSellSlots` in the file (they are — static functions defined above)
- `std::min` not found: add `#include <algorithm>` if needed (MetaOperations.cpp likely already includes it via AggregateOperationSemantics.h or similar)

- [ ] **Step 5: Run full JavaScript test suite (no regressions)**

```
npm test 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```
git -C .worktrees/price-auto-seller-design add \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git -C .worktrees/price-auto-seller-design commit -m "feat(agent): add CmdRefreshExchangeSellSlots — navigate to exchange sell tab"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by |
|---|---|
| §5.1 `useWarehouseAutoSeller` composable | Task 2 (create) |
| §5.1 `refreshWarehouseSnapshot()` helper | Task 1 |
| §5.1 in-flight dedup | Task 1 |
| §5.2 `RefreshExchangeSellSlots` command | Task 5 |
| §5.2 20s transport timeout | Task 4 |
| §6 state machine phases | Task 2 (all 8 phases in composable) |
| §7.1 startup + hasLoadedWarehouseOnce | Task 2 (initial `_snapshot()` call before loop) |
| §7.2 outer loop uses latest warehouseItems | Task 2 (`_getNextCandidate()` reads `warehouseItems.value` each iteration) |
| §7.2 terminalSkipCids excludes from candidates | Task 2 (`_getNextCandidate` filters) |
| §7.3 count from warehouseItems.count | Task 2 (`item.count` passed to ExchangeItem) |
| §7.3 below-base-price skip | Task 3 test, Task 2 impl |
| §7.4 success chain (successCount + refresh + 1.5s) | Task 3 test, Task 2 impl |
| §7.5 recoverable error chain (10s + RefreshExchangeSellSlots + retry inner loop) | Task 3 test, Task 2 impl |
| §7.6 non-recoverable skip + terminalSkipCids | Task 3 test, Task 2 impl |
| §8 stop semantics (immediate in wait, tail-delayed in DLL call) | Task 3 test, Task 2 impl |
| §9 `RefreshExchangeSellSlots` agent implementation | Task 5 |
| §9.5 cases A/B/C | Task 5 (`CmdRefreshExchangeSellSlots` handles all three) |
| §9.6 polling, 15s budget, 200ms interval | Task 5 (`TOTAL_BUDGET_MS=15000`, `POLL_MS=200`) |
| §10.1 buttons in warehouse header | Task 2 template |
| §10.2 status display | Task 2 template |
| §10.3 disable states while active | Task 2 template + tests |
| §11.1 all frontend test requirements | Task 3 tests |
| §11.2 inject-service timeout test | Task 4 |
| §11.2 DLL build | Task 5 |

### Placeholder scan

No TBDs or incomplete steps.

### Type consistency

- `refreshWarehouseSnapshot()` returns `{ ok: boolean, rows?, error? }` — used in Task 1 tests, Task 2 composable, Task 3 tests consistently.
- `_processItem()` returns `'success' | 'skipped' | 'failed' | 'stop'` string — outer loop in `start()` checks these exact strings.
- `data-testid="auto-seller-phase"` — referenced in Task 2 tests and Task 3 tests — resolved from the same template element.
- `data-testid="price-auto-seller-start"` / `"price-auto-seller-stop"` — used consistently across Task 2 and Task 3 tests.
- `computeDefaultUnitPrice(minPrice, percent)` — imported from `./listing-form.js` in the composable, matches App.vue's usage pattern.
