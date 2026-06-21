# Warehouse Detail Panel: Quick Listing Button

**Date:** 2026-06-13
**Scope:** `src/price/App.vue` — detail panel quick listing + `src/price/ListingModal.vue` (optional refactor)

## Goal

Add a "快速上架" (quick list) button to the warehouse detail panel. Clicking it lists the **entire owned count** of the selected collectible at the **default listing price percentage** — no modal, one click. The existing "上架" button that opens the modal is preserved.

## Non-Goals

- Existing ListingModal behavior is unchanged
- Opportunities and collections tabs are unaffected
- The listing default price percentage config is unchanged — reused as-is

## Target Behavior

1. Button visible when `activeTab === 'warehouse'` AND `canListItem` is true (desktop + selected item + owned count > 0). The button only appears on the warehouse tab — not on opportunities or collections tabs.
2. Button placed next to the existing "上架" button in the detail panel header
3. On click:
   a. Button enters loading state: disabled, text changes to "上架中..."
   b. Call `runAutoOperationCommand('GetItemTradeInfo', { itemCid })` to get current lowest price
   c. If `GetItemTradeInfo` fails → show error in `quickListingError` (red), abort
   d. Calculate `listPrice` via `computeDefaultUnitPrice(minPrice, listingDefaultPricePercent)` (reuses modal logic: floor then clamp to ≥1)
   e. If `listPrice < collectible.price` (base price) → show error in `quickListingError` (red), abort
   f. Call `runAutoOperationCommand('ExchangeItem', { itemCid, count: ownedCount, unitPrice: listPrice })`
   g. If `ExchangeItem` fails → show error in `quickListingError` (red)
   h. If `ExchangeItem` succeeds → refresh warehouse first, **then** write success message (prevents `syncWarehouseSelection` / `clearSelectedItemState` from clearing the message when the listed item disappears from warehouse)
4. Success messages use the existing `listingMessage` (green `.info-text`). Error messages use a new `quickListingError` ref displayed with `.error-text` (red). Both are cleared by `selectItem()` / `clearSelectedItemState()` on selection change.
5. The existing "上架" modal button and `isListingModalOpen` are not affected

## Design

### Modified: import in `App.vue`

Add `computeDefaultUnitPrice` to the existing import from `./listing-form.js`:

```js
import { DEFAULT_LISTING_PRICE_PERCENT, parseListingDefaultPricePercent, computeDefaultUnitPrice } from './listing-form.js';
```

### New State

```js
const isQuickListing = ref(false);
const quickListingError = ref('');
```

- `isQuickListing` — loading guard
- `quickListingError` — error text displayed with `.error-text` class; cleared in `selectItem()`, `clearSelectedItemState()`, `openListingModal()`, and `onItemListed()`

### New Function: `quickListSelectedItem()`

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
    // Step 1: Get current lowest price
    const tradeInfo = await window.bidkingDesktop.runAutoOperationCommand('GetItemTradeInfo', { itemCid });
    if (tradeInfo?.ok === false) throw new Error(tradeInfo.error || t('price.quickListing.fetchError'));

    const minPrice = Number(tradeInfo?.value?.minPrice);
    if (!Number.isFinite(minPrice) || minPrice <= 0) {
      throw new Error(t('price.quickListing.fetchError'));
    }

    // Step 2: Calculate listing price (reuse modal default pricing logic)
    const listPrice = computeDefaultUnitPrice(minPrice, listingDefaultPricePercent.value);
    if (listPrice === null) {
      throw new Error(t('price.quickListing.fetchError'));
    }

    // Step 3: Guard against listing below base price
    if (Number.isFinite(basePrice) && basePrice > 0 && listPrice < basePrice) {
      quickListingError.value = t('price.quickListing.belowBasePrice');
      return;
    }

    // Step 4: Submit
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

### Modified: `selectItem()`, `clearSelectedItemState()`, `openListingModal()`, `onItemListed()`

Add `quickListingError.value = ''` alongside the existing `listingMessage.value = ''` in `selectItem()` and `clearSelectedItemState()`. Also clear it in `openListingModal()` (when user opens modal after a failed quick-list attempt) and in `onItemListed()` (when modal listing succeeds).

### Modified Template: detail panel header

```html
<header>
  <div>
    <h2>{{ selectedDisplayItem?.name || t('price.history') }}</h2>
    <p>{{ selectedDisplayItem ? `${selectedDisplayItem.itemCid} / ${selectedDisplayItem.quality}` : t('price.noSelection') }}</p>
  </div>
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
  <button
    v-if="canListItem"
    class="primary-button"
    type="button"
    data-testid="price-listing-open"
    @click="openListingModal"
  >
    {{ t('price.listing.open') }}
  </button>
  <!-- refresh button unchanged -->
</header>
```

### i18n Keys

```js
// zh-CN
price: {
  quickListing: {
    button: '快速上架',
    loading: '上架中...',
    fetchError: '获取交易信息失败',
    belowBasePrice: '上架价低于原价，无法上架',
  }
}

// en
price: {
  quickListing: {
    button: 'Quick List',
    loading: 'Listing...',
    fetchError: 'Failed to fetch trade info',
    belowBasePrice: 'List price below base price',
  }
}
```

Add below the existing `<p v-if="listingMessage" class="info-text" ...>{{ listingMessage }}</p>`:

```html
<p v-if="quickListingError" class="error-text" data-testid="price-quick-listing-error">{{ quickListingError }}</p>
```

### Unchanged

- `ListingModal.vue` — untouched
- `canListItem`, `selectedOwnedCount`, `listingDefaultPricePercent`, `listingMessage` — all reused as-is
- `onItemListed()` — unused by quick listing (it handles modal close); quick listing calls `refreshWarehouseItems()` directly
- Opportunities / collections tabs — unaffected

### Flow

```
User selects warehouse item with owned count > 0
  → "快速上架" button visible in detail panel header
  → Click button
    → Loading: "上架中..."
    → GetItemTradeInfo → minPrice
    → listPrice = minPrice × percent / 100
    → listPrice < basePrice? → error "上架价低于原价"
    → ExchangeItem(itemCid, count=ownedCount, unitPrice=listPrice)
    → success → refresh warehouse, "上架成功"
    → failure → show error message
```

### Edge Cases

| Case | Behavior |
|------|----------|
| `GetItemTradeInfo` fails | Error message displayed, abort |
| `minPrice` is 0 or missing | Error "获取交易信息失败" (`quickListing.fetchError`), abort |
| `listPrice < basePrice` | Error "上架价低于原价，无法上架", abort |
| `ExchangeItem` fails | Error message from response displayed |
| `listingDefaultPricePercent` is invalid (≤0, NaN) | `parseListingDefaultPricePercent` normalizes to DEFAULT_LISTING_PRICE_PERCENT — same behavior as the modal listing flow |
| Concurrent clicks | `isQuickListing` guard prevents re-entry |
| Item not in warehouse but selected (edge) | `selectedOwnedCount = 0` → `canListItem = false` → button hidden |

## Files Changed

- `src/price/App.vue` — new state, function, template
- `src/shared/messages.js` — i18n keys (zh-CN + en)

## Testing

Update `src/price/App.test.js`:

1. **Button visible when warehouse tab + canListItem** — quick list button renders on warehouse tab when item selected and owned
2. **Button hidden on non-warehouse tabs** — switch to opportunities/collections, select owned item, assert quick list button absent
3. **Button hidden when canListItem is false** — button absent when item not owned or not on desktop
4. **Calls GetItemTradeInfo then ExchangeItem on click** — verify command sequence and arguments (count = ownedCount, unitPrice = calculated)
5. **Shows error (red .error-text) when GetItemTradeInfo fails** — verify `quickListingError` element with `.error-text` class appears
6. **Shows error (red .error-text) when listing price below base price** — mock basePrice > calculated listPrice, verify `quickListingError` text
7. **Refreshes warehouse then shows success (green .info-text)** — verify `GetStockContainers` called before `listingMessage` appears; "上架成功" visible after refresh completes
8. **Success message persists when listed item disappears from warehouse** — quick list all of the selected item, verify the row is gone AND `listingMessage` is still displayed
9. **Loading state** — button disabled and shows "上架中..." while request in flight
10. **Error clears when quick list is retried** — first call fails, error shown; second call succeeds, `quickListingError` cleared
11. **Error clears when modal listing succeeds after failed quick list** — quick list fails → red error shown → user opens modal and lists successfully → `quickListingError` removed, `listingMessage` shows green success
12. **Unit price floors at 1 for very cheap items** — mock minPrice = 1, percent = 98; verify `ExchangeItem` called with `unitPrice: 1` (not 0), matching `computeDefaultUnitPrice` behavior
