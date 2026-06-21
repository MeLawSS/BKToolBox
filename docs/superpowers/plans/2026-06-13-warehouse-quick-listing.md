# Warehouse Quick Listing Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "quick list" button to the warehouse detail panel that lists the entire owned count at the default price percentage, with price guard and error handling.

**Architecture:** Import `computeDefaultUnitPrice` from existing `listing-form.js`. Add `isQuickListing`/`quickListingError` state. New `quickListSelectedItem()` function orchestrates `GetItemTradeInfo` → price check → `ExchangeItem`. Error state uses `.error-text` (red), success uses existing `listingMessage` (green). Template adds button next to existing "上架" button, gated on `activeTab === 'warehouse'`.

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils

---

### Task 1: Add state, import, and i18n keys

**Files:**
- Modify: `src/price/App.vue:7` (import), `src/price/App.vue:32` (state)
- Modify: `src/shared/messages.js` (i18n)

- [ ] **Step 1: Add `computeDefaultUnitPrice` import**

In `src/price/App.vue`, change line 7:

```js
// Before:
import { DEFAULT_LISTING_PRICE_PERCENT, parseListingDefaultPricePercent } from './listing-form.js';

// After:
import { DEFAULT_LISTING_PRICE_PERCENT, parseListingDefaultPricePercent, computeDefaultUnitPrice } from './listing-form.js';
```

- [ ] **Step 2: Add state refs**

After `const listingMessage = ref('');` (line 32), add:

```js
const isQuickListing = ref(false);
const quickListingError = ref('');
```

- [ ] **Step 3: Add i18n keys**

In `src/shared/messages.js`, find the existing `price` zh-CN block and add a `quickListing` sub-object. In the `price` en block, add the same keys with English values.

zh-CN — find a suitable spot under `price:` (e.g., near `listing:` around line 224):

```js
quickListing: {
  button: '快速上架',
  loading: '上架中...',
  fetchError: '获取交易信息失败',
  belowBasePrice: '上架价低于原价，无法上架',
},
```

en — find the English `price:` block (around line 957):

```js
quickListing: {
  button: 'Quick List',
  loading: 'Listing...',
  fetchError: 'Failed to fetch trade info',
  belowBasePrice: 'List price below base price',
},
```

- [ ] **Step 4: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue src/shared/messages.js && git commit -m "feat: add quick listing state, import, and i18n keys"
```

---

### Task 2: Implement `quickListSelectedItem()` and clear `quickListingError` in existing functions

**Files:**
- Modify: `src/price/App.vue` — add function + clear error in existing functions

- [ ] **Step 1: Clear `quickListingError` in `selectItem()`**

In `selectItem()`, find the line `listingMessage.value = '';` (around line 477) and add after it:

```js
  quickListingError.value = '';
```

- [ ] **Step 2: Clear `quickListingError` in `clearSelectedItemState()`**

In `clearSelectedItemState()`, find `listingMessage.value = '';` (around line 419) and add after it:

```js
  quickListingError.value = '';
```

- [ ] **Step 3: Clear `quickListingError` in `openListingModal()`**

Change `openListingModal()` (lines 521-524) to:

```js
function openListingModal() {
  listingMessage.value = '';
  quickListingError.value = '';
  isListingModalOpen.value = true;
}
```

- [ ] **Step 4: Clear `quickListingError` in `onItemListed()`**

Change `onItemListed()` (lines 530-534) to:

```js
async function onItemListed() {
  isListingModalOpen.value = false;
  quickListingError.value = '';
  listingMessage.value = t('price.listing.success');
  await refreshWarehouseItems();
}
```

- [ ] **Step 5: Add `quickListSelectedItem()` function**

Insert after `closeListingModal()` (after line 528):

```js
async function quickListSelectedItem() {
  if (!selectedItemCid.value || isQuickListing.value) return;
  if (!selectedOwnedCount.value) return;

  isQuickListing.value = true;
  listingMessage.value = '';
  quickListingError.value = '';

  const itemCid = selectedItemCid.value;
  const count = selectedOwnedCount.value;
  const basePrice = Number(selectedDisplayItem.value?.basePrice);

  try {
    const tradeInfo = await window.bidkingDesktop.runAutoOperationCommand('GetItemTradeInfo', { itemCid });
    if (tradeInfo?.ok === false) throw new Error(tradeInfo.error || t('price.quickListing.fetchError'));

    const minPrice = Number(tradeInfo?.value?.minPrice);
    if (!Number.isFinite(minPrice) || minPrice <= 0) {
      throw new Error(t('price.quickListing.fetchError'));
    }

    const listPrice = computeDefaultUnitPrice(minPrice, listingDefaultPricePercent.value);
    if (listPrice === null) {
      throw new Error(t('price.quickListing.fetchError'));
    }

    if (Number.isFinite(basePrice) && basePrice > 0 && listPrice < basePrice) {
      quickListingError.value = t('price.quickListing.belowBasePrice');
      return;
    }

    const response = await window.bidkingDesktop.runAutoOperationCommand('ExchangeItem', {
      itemCid,
      count,
      unitPrice: listPrice,
    });
    if (response?.ok === false) throw new Error(response.error || t('price.listing.submitError'));

    await refreshWarehouseItems();
    listingMessage.value = t('price.listing.success');
  } catch (error) {
    quickListingError.value = error?.message || String(error);
  } finally {
    isQuickListing.value = false;
  }
}
```

- [ ] **Step 6: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: implement quickListSelectedItem with price guard"
```

---

### Task 3: Add quick listing button and error display to template

**Files:**
- Modify: `src/price/App.vue` — template

- [ ] **Step 1: Add quick listing button**

In the detail panel header, insert before the existing "上架" button (`<button v-if="canListItem" class="primary-button" type="button" data-testid="price-listing-open"`):

```html
          <button
            v-if="activeTab === 'warehouse' && canListItem"
            class="primary-button"
            type="button"
            data-testid="price-quick-listing"
            :disabled="isQuickListing"
            @click="quickListSelectedItem"
          >
            {{ isQuickListing ? t('price.quickListing.loading') : t('price.quickListing.button') }}
          </button>
```

- [ ] **Step 2: Add error display**

After the existing `<p v-if="listingMessage" ...>` line (line 873), add:

```html
        <p v-if="quickListingError" class="error-text" data-testid="price-quick-listing-error">{{ quickListingError }}</p>
```

- [ ] **Step 3: Verify build**

```bash
cd W:\BidKing && npx vite build --config vite.config.js 2>&1 | tail -5
```

- [ ] **Step 4: Run existing tests**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All 38 tests PASS (button only appears on warehouse tab with canListItem).

- [ ] **Step 5: Commit**

```bash
cd W:\BidKing && git add src/price/App.vue && git commit -m "feat: add quick listing button and error display to detail panel"
```

---

### Task 4: Add tests for quick listing

**Files:**
- Modify: `src/price/App.test.js` — insert before closing `});` of `describe('Price App', ...)`

- [ ] **Step 1: Test — button visible on warehouse tab with owned item**

```js
  it('shows the quick listing button on warehouse tab when an owned item is selected', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 3 }),
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

    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-quick-listing"]').exists()).toBe(true);
  });
```

- [ ] **Step 2: Test — button hidden on non-warehouse tabs**

```js
  it('hides the quick listing button on non-warehouse tabs even when an owned item is selected', async () => {
    const wrapper = await mountApp();
    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-quick-listing"]').exists()).toBe(false);
  });
```

- [ ] **Step 3: Test — success flow: GetItemTradeInfo → ExchangeItem → refresh → success message**

```js
  it('calls GetItemTradeInfo then ExchangeItem with full count and calculated unit price on quick list', async () => {
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022002, minPrice: 1600, totalCount: 7, tiers: [{ price: 1600, count: 2 }] } };
      }
      if (command === 'ExchangeItem') {
        return { ok: true, value: {} };
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

    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1022002 });
    // count = 4 (1 main + 3 stock), unitPrice = floor(1600 * 98 / 100) = 1568
    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022002, count: 4, unitPrice: 1568 });
    expect(runAutoOperationCommand.mock.calls.filter(([c]) => c === 'GetStockContainers')).toHaveLength(2);
    expect(wrapper.find('[data-testid="price-listing-message"]').text()).toContain('上架成功');
  });
```

- [ ] **Step 4: Test — error when GetItemTradeInfo fails**

```js
  it('shows a red error when GetItemTradeInfo fails during quick list', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: false, error: 'trade info unavailable' };
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
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    const errorEl = wrapper.find('[data-testid="price-quick-listing-error"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.classes()).toContain('error-text');
    expect(errorEl.text()).toContain('trade info unavailable');
  });
```

- [ ] **Step 5: Test — error when list price below base price**

```js
  it('shows a red error when the calculated list price is below the base price', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022002, minPrice: 1000, totalCount: 1, tiers: [{ price: 1000, count: 1 }] } };
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
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    // basePrice for 1022002 is 5000 (from collectibles.json test data)
    // listPrice = floor(1000 * 98 / 100) = 980, which is < 5000
    const errorEl = wrapper.find('[data-testid="price-quick-listing-error"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.classes()).toContain('error-text');
    expect(errorEl.text()).toContain('上架价低于原价');
  });
```

- [ ] **Step 6: Test — unit price floors at 1 for very cheap items**

```js
  it('uses unitPrice of 1 for very cheap items via computeDefaultUnitPrice floor', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022003, minPrice: 1, totalCount: 1, tiers: [{ price: 1, count: 1 }] } };
      }
      if (command === 'ExchangeItem') {
        return { ok: true, value: {} };
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
    await wrapper.find('[data-testid="warehouse-1022003"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    // floor(1 * 98 / 100) = 0, then Math.max(0, 1) = 1
    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022003, count: 1, unitPrice: 1 });
  });
```

- [ ] **Step 7: Test — error clears when modal listing succeeds after failed quick list**

```js
  it('clears the quick listing error when modal listing succeeds after a failed quick list', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022002, minPrice: 1000, totalCount: 1, tiers: [{ price: 1000, count: 1 }] } };
      }
      if (command === 'ExchangeItem') {
        return { ok: true, value: {} };
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
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Quick list fails (below base price)
    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-quick-listing-error"]').exists()).toBe(true);

    // Open modal and succeed
    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-quick-listing-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-listing-message"]').text()).toContain('上架成功');
  });
```

- [ ] **Step 8: Test — loading state**

```js
  it('disables the quick listing button and shows loading text while in flight', async () => {
    const tradeInfoDeferred = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') return tradeInfoDeferred.promise;
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    const btn = wrapper.find('[data-testid="price-quick-listing"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('上架中');

    tradeInfoDeferred.resolve({ ok: true, value: { itemCid: 1022002, minPrice: 1000, totalCount: 1, tiers: [{ price: 1000, count: 1 }] } });
    await flushPromises();
    await nextTick();

    expect(btn.attributes('disabled')).toBeUndefined();
  });
```

- [ ] **Step 9: Run all tests**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1 | tail -10
```

Expected: All 46 tests PASS (38 existing + 8 new).

- [ ] **Step 10: Commit**

```bash
cd W:\BidKing && git add src/price/App.test.js && git commit -m "test: add quick listing tests"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd W:\BidKing && npx vitest run src/price/App.test.js 2>&1
```

Expected: All tests PASS.

- [ ] **Step 2: Check git status**

```bash
cd W:\BidKing && git status
```
