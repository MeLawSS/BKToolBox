# Warehouse Tab: Filter by Live Collection CIDs

**Date:** 2026-06-13
**Scope:** `src/price/App.vue` — warehouse tab filtering logic

## Goal

The warehouse tab currently shows all items in the main warehouse (stockId=0). Add a second filter: only show items that are also in the user's **live in-game collection**, obtained via `GetCollectionItemCids`.

## Non-Goals

- Opportunities and collections tabs are **not** affected
- The InjectWarehousePanel is **not** affected
- The `/api/price-history/collections` / `Cids.json` route is **not** affected — `collectionCids` continues to power the Collections tab

## Target Behavior

1. On first warehouse refresh, call `GetCollectionItemCids` before `GetStockContainers`
2. On success: cache the collection CIDs as a `Set<number>` in `liveCollectionCids`; all subsequent refreshes reuse it without re-fetching
3. On failure: set `liveCollectionCids` to `null` (failed, do not retry); degrade to no collection filter. Log only transport-level exceptions (catch); `{ ok: false }` and malformed responses are expected degradation, not errors
4. `warehouseItems` computed: when `liveCollectionCids` is a `Set`, filter to items whose `itemCid` is in the set; otherwise apply no filter
5. `getWarehouseCandidateCids()` raw-warehouse-rows fallback: when `liveCollectionCids` is a `Set` (filter is active), disable the raw fallback so `syncWarehouseSelection()` never selects a filtered-out CID
6. When `liveCollectionCids` is `undefined` (not yet fetched), no filter applied — same behavior as today

## Design

### New State

```js
const liveCollectionCids = ref(undefined);
```

Three states:
- `undefined` — not yet fetched; no collection filter applied
- `null` — fetch failed; no collection filter applied, do **not** retry
- `Set<number>` — fetch succeeded; filter is active

### Modified: `refreshWarehouseItems()`

Insert the lazy collection fetch before the warehouse fetch:

```js
async function refreshWarehouseItems() {
  if (isRefreshingWarehouse.value) return;
  if (!canRefreshWarehouse.value) {
    warehouseError.value = t('price.refreshWarehouseUnavailable');
    return;
  }

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

  // ... existing GetStockContainers logic unchanged
}
```

Key: only `undefined` triggers a fetch. `null` (failed) and `Set` (cached) both skip.

### Modified: `warehouseItems` computed

Add a filter step after `.filter(Boolean)`:

```js
const warehouseItems = computed(() => {
  const items = warehouseRows.value
    .map((row) => {
      const item = buildDisplayItem(row?.itemCid ?? row?.cid);
      const count = Number(row?.count ?? row?.itemCount);
      if (!item) return null;
      return {
        ...item,
        count: Number.isFinite(count) ? count : 0,
        occupiedCells: getOccupiedCells(item),
      };
    })
    .filter(Boolean);

  // Apply live collection filter when available
  const cidSet = liveCollectionCids.value;
  const filtered = cidSet instanceof Set
    ? items.filter(item => cidSet.has(item.itemCid))
    : items;

  if (!warehouseSort.value.key) return filtered;

  return [...filtered].sort(compareWarehouseItems);
});
```

### Modified: `getWarehouseCandidateCids()`

When the collection filter is active, skip the raw-warehouse-rows fallback. Otherwise `syncWarehouseSelection()` could select a hidden CID:

```js
function getWarehouseCandidateCids() {
  const visibleCids = getVisibleWarehouseCids();
  if (visibleCids.length) return visibleCids;
  // When collection filter is active, do NOT fall back to raw rows
  // — that would leak filtered-out CIDs into the selection.
  if (liveCollectionCids.value instanceof Set) return [];
  return getRawWarehouseCids();
}
```

### Unchanged

- `getVisibleWarehouseCids()`, `resolveWarehouseSelectedCid()`, `resolveRequestedWarehouseCid()` — operate on already-filtered `warehouseItems`
- `syncWarehouseSelection()`, watchers, all other functions — untouched
- Collections tab, opportunities tab — untouched

### Flow

```
User clicks "刷新仓库" (first time)
  → liveCollectionCids === undefined → call GetCollectionItemCids
    → success → liveCollectionCids = Set([...])
    → failure → liveCollectionCids = null, console.error logged
  → call GetStockContainers
  → warehouseRows set
  → warehouseItems computed
    → Set? → filter to items with cid in Set
    → null/undefined? → no filter

User clicks "刷新仓库" (subsequent)
  → liveCollectionCids is Set (or null) → skip collection fetch
  → call GetStockContainers
  → warehouseItems computed (same filter logic)
```

### Edge Cases

| Case | Behavior |
|------|----------|
| First load, no prior fetch | `liveCollectionCids = undefined` → no filter |
| `GetCollectionItemCids` succeeds | `Set` stored → filter active; all subsequent refreshes reuse it |
| `GetCollectionItemCids` fails | `null` stored, error logged → no filter, never retried this page load |
| `GetStockContainers` fails (collection cached) | `warehouseError` shown, `liveCollectionCids` preserved |
| Collection is empty (`cids: []`) | Empty `Set` → warehouse table shows nothing |
| Raw fallback with active filter | `getWarehouseCandidateCids()` returns `[]` → selection clears |
| Index-based selection | `warehouseSelectedIndex` indexes into filtered list |

## Files Changed

- `src/price/App.vue` — logic changes
- `src/price/App.test.js` — test updates

## Testing

### Test helper extraction

All existing warehouse tests that call `runAutoOperationCommand` will need to handle `GetCollectionItemCids`. Extract a shared setup into the test helpers or add `GetCollectionItemCids` support to each mock.

Recommended: add a `createWarehouseMocks()` helper that returns a `runAutoOperationCommand` mock supporting both `GetCollectionItemCids` and `GetStockContainers`. For tests that don't need the collection filter, have `GetCollectionItemCids` return `{ ok: false }` (failure → `null` → no filter, same as today's behavior with no mock at all).

```js
function createWarehouseMocks(options = {}) {
  const collectionCids = options.collectionCids ?? null; // null = fail the call
  const stockResponses = options.stockResponses ?? [];
  let stockCallIndex = 0;

  return vi.fn(async (command) => {
    if (command === 'GetCollectionItemCids') {
      if (collectionCids === null) {
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

### New tests

1. **Filter applied when collection fetched** — mock `GetCollectionItemCids` returning a subset of warehouse CIDs, verify only matching rows render and non-matching rows absent
2. **Filter cached across refreshes** — `GetCollectionItemCids` called exactly once across two warehouse refreshes
3. **Degrade on `GetCollectionItemCids` failure** — mock failure (`ok: false`), verify all main warehouse items shown (no filter)
4. **Empty collection shows nothing** — `{cids: [], count: 0}`, verify "暂无仓库藏品" displayed
5. **No raw fallback when filter active** — collection filter active, `warehouseItems` empty, verify detail panel clears (does not select a filtered-out CID)
6. **Index-based selection follows filtered list** — `warehouseSelectedIndex` 0 selects first filtered item after collection filter is applied

### Updated existing tests

All existing warehouse tests that mock `runAutoOperationCommand` must also handle `GetCollectionItemCids`. Use the `createWarehouseMocks()` helper with `collectionCids: null` so they fail silently and degrade — preserving current test assertions unchanged.
