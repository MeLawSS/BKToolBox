# Warehouse Tab: Live Collection Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live in-game collection filter to the warehouse tab via `GetCollectionItemCids`, cached per page lifetime and degrading gracefully on failure.

**Architecture:** Add a three-state `liveCollectionCids` ref (`undefined`/`null`/`Set`). Lazily fetch on first warehouse refresh. Apply as a filter in `warehouseItems` computed. Guard `getWarehouseCandidateCids()` raw fallback when filter is active.

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils

---

### Task 1: Add `liveCollectionCids` ref and `createWarehouseMocks` test helper

**Files:**
- Modify: `src/price/App.vue:18`
- Modify: `src/price/App.test.js` — add helper before `describe('Price App', ...)`

- [ ] **Step 1: Add the ref in App.vue**

After `const warehouseSelectedIndex = ref(0);` (line 18), add:

```js
const liveCollectionCids = ref(undefined);
```

- [ ] **Step 2: Add the test helper in App.test.js**

Insert before `describe('Price App', () => {` (before line 176):

```js
function createWarehouseMocks(options = {}) {
  const collectionCids = Object.prototype.hasOwnProperty.call(options, 'collectionCids')
    ? options.collectionCids
    : undefined;
  const stockResponses = Array.isArray(options.stockResponses) ? options.stockResponses : [];
  let stockCallIndex = 0;

  return vi.fn(async (command) => {
    if (command === 'GetCollectionItemCids') {
      if (collectionCids === undefined) {
        return { ok: false, error: 'not available' };
      }
      return { ok: true, value: { cids: collectionCids, count: collectionCids.length } };
    }
    if (command === 'GetStockContainers') {
      const res = stockResponses[Math.min(stockCallIndex, stockResponses.length - 1)];
      stockCallIndex += 1;
      return { ok: true, value: res };
    }
    throw new Error(`unexpected command: ${command}`);
  });
}
```

When `collectionCids` is omitted (`undefined`), `GetCollectionItemCids` returns `{ ok: false }` — simulating "not available" → degrade to no filter. This preserves all existing test behavior unchanged.

- [ ] **Step 3: Verify tests still pass with the unused helper**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All 32 tests PASS (ref unused, helper unused).

- [ ] **Step 4: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue src/price/App.test.js && git commit -m "feat: add liveCollectionCids ref and createWarehouseMocks helper"
```

---

### Task 2: Modify `refreshWarehouseItems()` — lazy fetch collection CIDs

**Files:**
- Modify: `src/price/App.vue:359-379`

- [ ] **Step 1: Insert collection fetch before GetStockContainers**

Replace lines 366-368 (`isRefreshingWarehouse.value = true; warehouseError.value = ''; try {`) with the lazy fetch block:

```js
  isRefreshingWarehouse.value = true;
  warehouseError.value = '';

  // Lazily fetch live collection CIDs once per page lifetime
  if (liveCollectionCids.value === undefined) {
    try {
      const cidResponse = await window.bidkingDesktop.runAutoOperationCommand('GetCollectionItemCids', {});
      if (cidResponse?.ok !== false && Array.isArray(cidResponse?.value?.cids)) {
        liveCollectionCids.value = new Set(
          cidResponse.value.cids.map(Number).filter(Number.isSafeInteger)
        );
      } else {
        liveCollectionCids.value = null;
      }
    } catch (error) {
      console.error('GetCollectionItemCids failed:', error);
      liveCollectionCids.value = null;
    }
  }

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('GetStockContainers', {});
```

The existing `try/catch/finally` for `GetStockContainers` is preserved after this block.

- [ ] **Step 2: Run tests to verify existing warehouse tests still pass**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -20
```

Expected: Some tests will FAIL because existing mocks don't handle `GetCollectionItemCids`. This is expected — Task 3 will fix them.

- [ ] **Step 3: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: lazy fetch GetCollectionItemCids on first warehouse refresh"
```

---

### Task 3: Update existing warehouse tests to use `createWarehouseMocks`

**Files:**
- Modify: `src/price/App.test.js` — update all tests that mock `runAutoOperationCommand` for warehouse operations

All existing warehouse tests that mock `runAutoOperationCommand` only handle `GetStockContainers`. They need to be switched to `createWarehouseMocks()` which also handles `GetCollectionItemCids` (returning `{ ok: false }` to degrade silently).

Affected tests (search for `GetStockContainers` in test file to find all):
- Line 282: "refreshes warehouse collectibles..."
- Line 338: "shows only collectibles present in the main warehouse..."
- Line 384: "defaults the warehouse panel to index 0..."
- Line 425: "falls back to saved index when clicking a search result..."
- Line 472: "falls back to sort-synced index..."
- Line 527: "keeps a default warehouse selection when warehouse refresh finishes before collectibles metadata loads" — uses `GetStockContainers` but also deferred collectibles fetch; keep this one as-is (it uses custom fetch mock)
- Line 604: "re-syncs to the first visible warehouse collectible..." — same deferred pattern, keep as-is
- Line 691: "renders occupied cells and sorts warehouse rows..."
- Plus all tests added in the previous feature (Tasks 1-7 in App.test.js additions)

- [ ] **Step 1: Update the test at line 282**

Replace the inline `runAutoOperationCommand` mock:

```js
// Before (lines 283-307):
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([...]),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

// After:
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1099001', itemCid: 1099001, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
          createWarehouseContainer({
            stockId: 2,
            stockCid: 9102,
            items: [
              createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
            ],
          }),
        ]),
      ],
    });
```

The `collectionCids` option is omitted → `undefined` → `GetCollectionItemCids` returns `{ ok: false }` → degrade → no filter → test assertions unchanged.

- [ ] **Step 2: Repeat for all remaining warehouse tests**

Apply the same conversion pattern to each test that mocks `runAutoOperationCommand` with `GetStockContainers`:
1. Replace `vi.fn(async (command) => { if (command === 'GetStockContainers') { ... } throw ... })` with `createWarehouseMocks({ stockResponses: [...] })`
2. For tests with multiple responses (callIndex pattern), pass `stockResponses: [snapshot1, snapshot2, ...]`

Tests to convert:
- Line 338: `stockResponses: [snapshot]`
- Line 384: `stockResponses: [snapshot]`
- Line 425: `stockResponses: [snapshot]`
- Line 472: `stockResponses: [snapshot]`
- Line 691: `stockResponses: [snapshot]`
- Tests from previous feature (index-based selection): convert each to use `createWarehouseMocks` with appropriate `stockResponses`

Tests to skip (keep as-is due to custom fetch mocks):
- Line 527 and Line 604: deferred collectibles pattern — the custom `vi.stubGlobal('fetch', ...)` is needed
- Line 1012: `runAutoOperationCommand` returns `{ items: [] }` for warehouse (no `GetStockContainers`), keep as-is
- Line 1024: uses `ExchangeItem` and `GetItemTradeInfo` commands — convert `GetStockContainers` parts

- [ ] **Step 3: Run tests after all conversions**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All existing tests PASS (32 tests). `GetCollectionItemCids` degrades silently for all of them.

- [ ] **Step 4: Commit**

```bash
cd W:\BidKing && git add src/price/App.test.js && git commit -m "test: switch warehouse tests to createWarehouseMocks helper"
```

---

### Task 4: Modify `warehouseItems` computed — apply collection filter

**Files:**
- Modify: `src/price/App.vue:68-85`

- [ ] **Step 1: Add the collection filter**

Replace the return statement in `warehouseItems` computed:

```js
// Before (lines 80-84):
    .filter(Boolean);

  if (!warehouseSort.value.key) return items;

  return [...items].sort(compareWarehouseItems);

// After:
    .filter(Boolean);

  // Apply live collection filter when available
  const cidSet = liveCollectionCids.value;
  const filtered = cidSet instanceof Set
    ? items.filter(item => cidSet.has(item.itemCid))
    : items;

  if (!warehouseSort.value.key) return filtered;

  return [...filtered].sort(compareWarehouseItems);
```

- [ ] **Step 2: Run tests**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All 32 tests PASS (collection filter inactive in all existing tests — `liveCollectionCids` is `undefined` after init, and `createWarehouseMocks` without `collectionCids` returns `{ ok: false }` → `null`).

- [ ] **Step 3: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: filter warehouse items by live collection CIDs"
```

---

### Task 5: Modify `getWarehouseCandidateCids()` — block raw fallback when filter active

**Files:**
- Modify: `src/price/App.vue:409-413`

- [ ] **Step 1: Add the guard**

```js
// Before:
function getWarehouseCandidateCids() {
  const visibleCids = getVisibleWarehouseCids();
  if (visibleCids.length) return visibleCids;
  return getRawWarehouseCids();
}

// After:
function getWarehouseCandidateCids() {
  const visibleCids = getVisibleWarehouseCids();
  if (visibleCids.length) return visibleCids;
  // When collection filter is active, do NOT fall back to raw warehouse rows
  // — that would leak filtered-out CIDs into the selection.
  if (liveCollectionCids.value instanceof Set) return [];
  return getRawWarehouseCids();
}
```

- [ ] **Step 2: Run tests**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All 32 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: block raw warehouse fallback when collection filter is active"
```

---

### Task 6: Add new tests for collection filter behavior

**Files:**
- Modify: `src/price/App.test.js` — insert before the closing `});` of `describe('Price App', ...)`

- [ ] **Step 1: Test — filter applied when collection fetched**

```js
  it('filters warehouse items to only those in the live collection', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1022002, 1022003],
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
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

    // Only 1022002 and 1022003 are in collection → visible
    const warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain(getTestCollectible(1022003).name);
    expect(warehouseText).not.toContain(getTestCollectible(1022001).name);
  });
```

- [ ] **Step 2: Test — GetCollectionItemCids called only once across refreshes**

```js
  it('fetches GetCollectionItemCids only once across multiple warehouse refreshes', async () => {
    const snapshot = createWarehouseSnapshot([
      createWarehouseContainer({
        stockId: 0,
        items: [
          createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
        ],
      }),
    ]);
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1022002],
      stockResponses: [snapshot],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {});

    // Second refresh — should not call GetCollectionItemCids again
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    const collectionCalls = runAutoOperationCommand.mock.calls.filter(
      ([command]) => command === 'GetCollectionItemCids'
    );
    expect(collectionCalls).toHaveLength(1);
  });
```

- [ ] **Step 3: Test — degrade on GetCollectionItemCids failure**

```js
  it('shows all main warehouse items when GetCollectionItemCids fails', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      // collectionCids omitted → { ok: false } → degrade
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
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

    // Both items visible — no collection filter applied
    const warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain(getTestCollectible(1022001).name);
  });
```

- [ ] **Step 4: Test — empty collection shows nothing**

```js
  it('shows empty warehouse when collection is empty', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [],
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
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

    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('暂无仓库藏品');
  });
```

- [ ] **Step 5: Test — raw fallback guarded when filter active**

```js
  it('does not select a filtered-out CID when collection filter produces an empty table', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1099001], // 1099001 not in collectibles → filtered out by buildDisplayItem
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
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

    // Warehouse table is empty (no matching collection items)
    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('暂无仓库藏品');
    // Detail panel should NOT show a warehouse item (raw fallback blocked)
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('请选择藏品查看趋势');
  });
```

- [ ] **Step 6: Run all tests**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All tests PASS (37 = 32 existing + 5 new).

Fix any failures before proceeding.

- [ ] **Step 7: Commit**

```bash
cd W:\BidKing && git add src/price/App.test.js && git commit -m "test: add live collection filter tests"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1
```

Expected: All tests PASS.

- [ ] **Step 2: Final commit if needed**

```bash
cd W:\BidKing && git status
```
