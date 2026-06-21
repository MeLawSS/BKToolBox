# Warehouse Tab: Index-Based Selection on Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve warehouse tab selection by index position across data refreshes, with user clicks always taking priority over index.

**Architecture:** Add a `warehouseSelectedIndex` ref that tracks the visual index of the selected warehouse row. `resolveWarehouseSelectedCid()` (data-refresh path) uses this index directly. `resolveRequestedWarehouseCid()` (user-click path) respects the clicked CID first, falling back to index only when the CID is absent. Sort silently syncs the index via a new `watch(warehouseSort, deep)`. Tab switch preserves the current CID via a guard in `watch(activeTab)`.

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils

---

### Task 1: Add `warehouseSelectedIndex` ref

**Files:**
- Modify: `src/price/App.vue:17`

- [ ] **Step 1: Add the ref**

In `src/price/App.vue`, add after line 17 (`const selectedItemCid = ref(null);`):

```js
const warehouseSelectedIndex = ref(0);
```

- [ ] **Step 2: Verify app still compiles**

```bash
cd W:\BidKing && npx vite build --config vite.config.js 2>&1 | tail -5
```

Expected: Build succeeds (ref is unused for now — may produce a lint warning, that's fine).

---

### Task 2: Modify `resolveWarehouseSelectedCid()` — pure index-based

**Files:**
- Modify: `src/price/App.vue:414-421`

- [ ] **Step 1: Replace the function body**

Replace lines 414-421:

```js
function resolveWarehouseSelectedCid() {
  const warehouseCids = getWarehouseCandidateCids();
  if (!warehouseCids.length) return null;

  const idx = warehouseSelectedIndex.value;
  if (idx < warehouseCids.length) return warehouseCids[idx];
  return warehouseCids[warehouseCids.length - 1];
}
```

This removes the CID-matching guard (`selectedItemTab.value === 'warehouse' && warehouseCids.includes(...)`) and the `warehouseCids[0]` fallback. Now it's pure index-based: use the saved index, clamp to last if out of bounds, return null if empty.

- [ ] **Step 2: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: add warehouseSelectedIndex and index-based resolveWarehouseSelectedCid"
```

---

### Task 3: Modify `resolveRequestedWarehouseCid()` — CID-first with index fallback

**Files:**
- Modify: `src/price/App.vue:423-428`

- [ ] **Step 1: Replace the function body**

Replace lines 423-428:

```js
function resolveRequestedWarehouseCid(requestedCid) {
  const warehouseCids = getWarehouseCandidateCids();
  if (!warehouseCids.length) return requestedCid;
  if (warehouseCids.includes(requestedCid)) return requestedCid;

  // Fallback: requested CID not in warehouse list → use index
  const idx = warehouseSelectedIndex.value;
  if (idx < warehouseCids.length) return warehouseCids[idx];
  return warehouseCids[warehouseCids.length - 1];
}
```

The `warehouseCids[0]` fallback is replaced with index-based fallback.

- [ ] **Step 2: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: CID-first resolveRequestedWarehouseCid with index fallback"
```

---

### Task 4: Record index in `selectItem()` on warehouse selection

**Files:**
- Modify: `src/price/App.vue:430-447`

- [ ] **Step 1: Add index recording after nextCid resolution**

In `selectItem()`, after `nextCid` is resolved and before `selectedItemCid.value = nextCid`, insert the index recording block. The full modified function:

```js
async function selectItem(itemCid, itemTab = activeTab.value) {
  const cid = Number(itemCid);
  if (!Number.isSafeInteger(cid)) return;
  const nextCid = itemTab === 'warehouse'
    ? resolveRequestedWarehouseCid(cid)
    : cid;

  if (itemTab === 'warehouse') {
    const idx = warehouseItems.value.findIndex(item => item.itemCid === nextCid);
    if (idx >= 0) warehouseSelectedIndex.value = idx;
  }

  selectedItemCid.value = nextCid;
  selectedItemTab.value = itemTab;
  selectedHistory.value = [];
  itemRefreshError.value = '';
  listingMessage.value = '';
  isListingModalOpen.value = false;
  try {
    await loadSelectedHistory(nextCid);
  } catch (error) {
    errorText.value = getErrorMessage(error);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: record warehouseSelectedIndex on warehouse row click"
```

---

### Task 5: Add tab switch guard to `watch(activeTab)`

**Files:**
- Modify: `src/price/App.vue:497-500`

- [ ] **Step 1: Add the CID-visible guard**

Replace lines 497-500:

```js
watch(activeTab, (tab) => {
  if (tab !== 'warehouse') return;
  const warehouseCids = getVisibleWarehouseCids();
  if (
    warehouseCids.length &&
    selectedItemTab.value === 'warehouse' &&
    warehouseCids.includes(selectedItemCid.value)
  ) {
    return;
  }
  syncWarehouseSelection();
});
```

- [ ] **Step 2: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: skip warehouse re-sync on tab switch when CID is still visible"
```

---

### Task 6: Add `watch(warehouseSort, deep)` for silent index sync on sort

**Files:**
- Modify: `src/price/App.vue` — insert after the activeTab watcher (after line 500)

- [ ] **Step 1: Add the sort sync watcher**

Insert after the `watch(activeTab, ...)` block (after the closing `});` on line 500):

```js
watch(warehouseSort, () => {
  if (activeTab.value !== 'warehouse' || !selectedItemCid.value) return;
  const idx = warehouseItems.value.findIndex(item => item.itemCid === selectedItemCid.value);
  if (idx >= 0) warehouseSelectedIndex.value = idx;
}, { deep: true });
```

- [ ] **Step 2: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: silently sync warehouseSelectedIndex on sort"
```

---

### Task 7: Update existing tests to match new behavior

**Files:**
- Modify: `src/price/App.test.js:384-525`

Three existing tests are affected. Two need description updates (behavior unchanged because index defaults to 0). One needs assertion updates.

- [ ] **Step 1: Update test at line 384 — rename only**

Change the test name from `'defaults the warehouse panel to the first warehouse collectible after refresh'` to:

```js
  it('defaults the warehouse panel to index 0 (first collectible) after refresh', async () => {
```

The assertions remain unchanged because index defaults to 0, selecting the first warehouse item.

- [ ] **Step 2: Update test at line 425 — rename and reword**

Change the test name from `'defaults the detail panel to the first warehouse collectible when a non-warehouse collectible is selected on the warehouse tab'` to:

```js
  it('falls back to saved index when clicking a search result whose CID is not in the warehouse list', async () => {
```

The assertions remain unchanged — when no prior selection was made, index is 0, selecting the first item. Same behavior, correct description.

- [ ] **Step 3: Update test at line 472 — rename and fix assertions**

This test currently expects that after sorting and clicking a non-warehouse search result, the FIRST visible item is selected. After our change, the sort watcher silently syncs `warehouseSelectedIndex` to the new position of the currently selected CID, then the fallback uses that synced index.

Trace of the new behavior in this test:
1. Refresh: warehouse = [1022002, 1022003, 1022001], index defaults to 0 → selects 1022002, records index 0
2. Sort cells descending twice → order = [1022001, 1022003, 1022002]
3. `watch(warehouseSort)` fires → `selectedItemCid` = 1022002, finds it at index 2 → `warehouseSelectedIndex` = 2
4. Click search for 1022004 (not in warehouse) → `resolveRequestedWarehouseCid(1022004)` → 1022004 not in list → fallback to index 2 → returns 1022002

So the assertion should expect **1022002** (the item at synced index 2, i.e., the last item), not 1022001 (the first item).

Change the test name to:

```js
  it('falls back to sort-synced index when clicking a non-warehouse search result after sorting', async () => {
```

Replace the assertions block (lines 519-524):

```js
    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022002).name);
    expect(detailText).not.toContain(getTestCollectible(1022004).name);
```

- [ ] **Step 4: Run the full test suite to verify existing tests pass**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd W:\BidKing && git add src/price/App.test.js && git commit -m "test: update warehouse selection tests for index-based behavior"
```

---

### Task 8: Add new tests for comprehensive index-based selection behavior

**Files:**
- Modify: `src/price/App.test.js` — add tests before the closing `});` of the `describe('Price App', ...)` block (before line 1141)

- [ ] **Step 1: Add test — click warehouse row records index and selects that row**

```js
  it('selects the clicked warehouse row and records its index', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
              ],
            }),
          ]),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click the second row (index 1)
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });
```

- [ ] **Step 2: Add test — refresh keeps same index when CIDs change**

```js
  it('keeps the same index after refresh even when warehouse CIDs change', async () => {
    const responses = [
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
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 1, count: 3 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 2, count: 1 }),
          ],
        }),
      ]),
    ];
    let callIndex = 0;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        const res = responses[callIndex];
        callIndex += 1;
        return { ok: true, value: res };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click index 1 (1022001)
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Refresh — new warehouse CIDs: [1022004, 1022003, 1022001]
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Index 1 is now 1022003
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022003).name);
  });
```

- [ ] **Step 3: Add test — selects last item when index exceeds new list length**

```js
  it('selects the last warehouse item when the saved index exceeds the new list length', async () => {
    const responses = [
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
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
          ],
        }),
      ]),
    ];
    let callIndex = 0;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        const res = responses[callIndex];
        callIndex += 1;
        return { ok: true, value: res };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click index 2 (1022003, the last item)
    await wrapper.find('[data-testid="warehouse-1022003"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');

    // Refresh — new list only has 1 item, index 2 is out of bounds
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Should select the last (only) item
    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022004).name);
  });
```

- [ ] **Step 4: Add test — empty warehouse list clears selection**

```js
  it('clears the warehouse selection when refresh returns an empty list', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([]),
    ];
    let callIndex = 0;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        const res = responses[callIndex];
        callIndex += 1;
        return { ok: true, value: res };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');

    // Refresh with empty list
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('请选择藏品查看趋势');
  });
```

- [ ] **Step 5: Add test — sort keeps selected CID and silently syncs index**

```js
  it('keeps the selected CID on sort and silently syncs the index to its new position', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 1, count: 2 }),
                createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 2, count: 1 }),
              ],
            }),
          ]),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click the last row (index 2, 1022001)
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Sort by cells ascending → order becomes [1022002, 1022003, 1022001]
    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    // 1022001 is still selected (sort keeps CID), now at index 2
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Search for non-warehouse item and click → should use synced index 2 (where 1022001 landed)
    await wrapper.find('input[type="search"]').setValue('1022004');
    await nextTick();
    const searchButton = wrapper.findAll('[data-testid="price-search-results"] button')
      .find((button) => button.text().includes('1022004'));
    await searchButton.trigger('click');
    await flushPromises();
    await nextTick();

    // Falls back to synced index 2 → 1022001 still selected
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });
```

- [ ] **Step 6: Add test — sort then refresh uses synced index**

```js
  it('uses the sort-synced index on the next data refresh', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 2, count: 2 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 2, count: 1 }),
          ],
        }),
      ]),
    ];
    let callIndex = 0;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        const res = responses[callIndex];
        callIndex += 1;
        return { ok: true, value: res };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Initial order: [1022003, 1022001, 1022002]. Click index 2 (1022002)
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Sort by cells → 1022002 moves. Cells: 1022003=2, 1022001=4, 1022002=1
    // Ascending: [1022002, 1022003, 1022001]
    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);
    // 1022002 still selected, now at index 0 → index silently synced to 0

    // Refresh with different CIDs at same positions
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // New list: [1022004, 1022001, 1022002]. Index 0 = 1022004
    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022004).name);
  });
```

- [ ] **Step 7: Add test — tab switch preserves CID when still in warehouse**

```js
  it('preserves the selected CID when switching back to the warehouse tab', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              ],
            }),
          ]),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    // Set up warehouse with selection
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Switch to opportunities
    await wrapper.find('[data-testid="price-tab-opportunities"]').trigger('click');
    await nextTick();

    // Switch back to warehouse — CID should still be selected
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });
```

- [ ] **Step 8: Run the full test suite**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1
```

Expected: All tests PASS (existing + new).

- [ ] **Step 9: Commit**

```bash
cd W:\BidKing && git add src/price/App.test.js && git commit -m "test: add comprehensive index-based warehouse selection tests"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run the full test suite including lint and build**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 && npx eslint src/price/App.vue src/price/App.test.js 2>&1
```

Expected: All tests PASS, no lint errors.

- [ ] **Step 2: Final commit if any lint fixes were needed**

```bash
cd W:\BidKing && git add -A && git commit -m "chore: final lint fixes for warehouse index selection"
```
