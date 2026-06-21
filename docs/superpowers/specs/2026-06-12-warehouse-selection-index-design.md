# Warehouse Tab: Index-Based Selection on Refresh

**Date:** 2026-06-12
**Scope:** `src/price/App.vue` — warehouse tab selection logic

## Goal

When the warehouse list **data refreshes** (manual refresh, after listing), preserve the user's selection by **index position** rather than resetting to the first item.

When the user **actively clicks** a warehouse row or search result, respect that click — index tracking follows the click, not the other way around.

When the user **sorts** the warehouse table, the selected CID stays, and the saved index is silently synced to the CID's new visual position so the next data refresh still picks the right row.

## Non-Goals

- Opportunities and collections tabs are **not** affected — they keep their current CID-based selection behavior
- The InjectWarehousePanel (inject workspace) is **not** affected — it has no row selection
- Sort behavior for the **selected item** is not changed — sort still keeps the selected CID

## Current Behavior

- `resolveWarehouseSelectedCid()` and `resolveRequestedWarehouseCid()` both default to `warehouseCids[0]` (the first item) when a previously selected CID is no longer in the list
- Refreshing the warehouse list can unexpectedly jump selection back to the first row

## Target Behavior

1. Track the **index** of the selected item in the warehouse list via `warehouseSelectedIndex`
2. On **data refresh**, select the item at the **same index** (regardless of whether the old CID is still present)
3. If the new list is shorter than the saved index → select the **last** item
4. First load (default index 0) → select the **first** item
5. The index is updated every time the user clicks a warehouse row
6. **User clicks always take priority**: clicking a row selects that row by CID; clicking a search result whose CID is in the warehouse list selects that CID directly; clicking a search result whose CID is **not** in the warehouse list falls back to the saved index (not the first item)
7. **Sort silently syncs the index**: when the user sorts, the selected CID stays put, and `warehouseSelectedIndex` is updated to match the CID's new visual position — so the next data refresh preserves the current visual row
8. **Tab switch preserves CID**: switching back to the warehouse tab keeps the currently selected CID if it is still in the warehouse list; index-based resolution only fires when the old CID has disappeared

## Design

### New State

```js
const warehouseSelectedIndex = ref(0);
```

Default `0` ensures first load selects the first item. Placed near `selectedItemCid`.

### Modified: `selectItem()`

After resolving the warehouse CID, record its index from the current `warehouseItems`:

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
  // ... rest unchanged
}
```

### Modified: `resolveWarehouseSelectedCid()`

**Sync/refresh path** — called from `syncWarehouseSelection()` during data refresh. Pure index-based:

```js
function resolveWarehouseSelectedCid() {
  const warehouseCids = getWarehouseCandidateCids();
  if (!warehouseCids.length) return null;

  const idx = warehouseSelectedIndex.value;
  if (idx < warehouseCids.length) return warehouseCids[idx];
  return warehouseCids[warehouseCids.length - 1];
}
```

### Modified: `resolveRequestedWarehouseCid()`

**User-click path** — respect `requestedCid` first. Only fall back to index when the requested CID is not in the warehouse list:

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

### Modified: `watch(activeTab)` — tab switch guard

Add a short-circuit so switching back to warehouse tab keeps the current CID if it is still visible:

```js
// Before (current):
watch(activeTab, (tab) => {
  if (tab !== 'warehouse') return;
  syncWarehouseSelection();
});

// After:
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

### New: `watch(warehouseSort)` — silent index sync on sort

When the user sorts, the selected CID stays but moves to a new visual position. Silently update `warehouseSelectedIndex` so the next data refresh follows the current visual row:

```js
watch(warehouseSort, () => {
  if (activeTab.value !== 'warehouse' || !selectedItemCid.value) return;
  const idx = warehouseItems.value.findIndex(item => item.itemCid === selectedItemCid.value);
  if (idx >= 0) warehouseSelectedIndex.value = idx;
}, { deep: true });
```

This watcher fires only on sort changes (`warehouseSort` is mutated, not replaced). Data refresh changes `warehouseRows`, not `warehouseSort`, so the index is not overwritten by old-CID-matching during refresh.

### Unchanged

- **CID visibility watcher** — `watch(() => getVisibleWarehouseCids().join(','), ...)` is **unchanged**. It retains the short-circuit so that sort (which changes join order) does not trigger `syncWarehouseSelection()`. The selected CID stays put on sort. In the rare case where data refresh removes the old CID *and* `refreshWarehouseItems()` hasn't called `syncWarehouseSelection()` yet, this watcher catches it — but `syncWarehouseSelection()` has a no-op guard so double-invocation is harmless.
- `syncWarehouseSelection()` — unchanged (calls `resolveWarehouseSelectedCid()`, inherits index logic)
- `refreshWarehouseItems()` — unchanged (already calls `syncWarehouseSelection()` explicitly — this is the index path)
- `onItemListed()` — unchanged
- Opportunities / collections tabs — completely untouched

### Path summary

| Trigger | Path | Logic | `warehouseSelectedIndex` |
|---------|------|-------|--------------------------|
| **User click** row or search result (CID in warehouse) | `selectItem()` → `resolveRequestedWarehouseCid(cid)` | CID match → click honored | Updated to CID's position |
| **User click** search result (CID not in warehouse) | `selectItem()` → `resolveRequestedWarehouseCid(cid)` | Index fallback | Updated to fallback position |
| **Data refresh** | `refreshWarehouseItems()` → `syncWarehouseSelection()` → `resolveWarehouseSelectedCid()` | Pure index | Used as input, then updated by `selectItem()` |
| **Sort** | `watch(warehouseSort)` → silent index sync | CID unchanged, index synced to new position | Updated to CID's new position |
| **Tab switch** (CID still visible) | `watch(activeTab)` → early return | CID kept | Unchanged |
| **Tab switch** (CID gone) | `watch(activeTab)` → `syncWarehouseSelection()` → `resolveWarehouseSelectedCid()` | Index fallback | Used as input |

### Flow

```
User clicks warehouse row with CID=X at index n
  → resolveRequestedWarehouseCid(X) → X is in list → returns X
  → warehouseSelectedIndex saved as n
  → selection = X ✓

User clicks search result with CID=Y (warehouse tab active, Y in warehouse)
  → resolveRequestedWarehouseCid(Y) → Y is in list → returns Y
  → warehouseSelectedIndex saved as Y's index in warehouse list
  → selection = Y ✓

User clicks search result with CID=Z (warehouse tab active, Z NOT in warehouse)
  → resolveRequestedWarehouseCid(Z) → Z not in list → index fallback
  → warehouseSelectedIndex used to pick CID from warehouse list
  → selection = warehouse item at saved index ✓

Data refreshes (manual refresh / after listing)
  → refreshWarehouseItems()
    → warehouseRows updated
    → syncWarehouseSelection()
      → resolveWarehouseSelectedCid()
        → n < newList.length → warehouseCids[n]
        → n >= newList.length → warehouseCids[last]
        → list is empty → null → clear selection

User sorts warehouse table
  → watch(warehouseSort) fires
    → finds selected CID's new position → updates warehouseSelectedIndex silently
  → CID visibility watcher fires → old CID still visible → short-circuit → no re-selection
  → selection = same CID, index synced ✓

User switches away from warehouse then back
  → watch(activeTab) fires
    → CID still in warehouse list → early return → selection unchanged ✓
```

### Edge Cases

| Case | Behavior |
|------|----------|
| First load (no prior selection) | Index defaults to 0, selects first item |
| List shrinks below saved index on refresh | Selects last item |
| List becomes empty on refresh | Clears selection |
| Tab switch away and back (CID still in list) | CID kept, no index re-selection |
| Tab switch away and back (CID gone, e.g. data changed while on other tab) | Falls back to saved index |
| Sort then refresh | Sort silently synced index → refresh uses correct visual position |
| Click search result whose CID is not in warehouse | Falls back to saved index position, not first item |

## Files Changed

- `src/price/App.vue` — logic changes
- `src/price/App.test.js` — test updates

## Testing

Update `src/price/App.test.js` to cover:

1. **Index 0 on first load** — default index selects first warehouse item
2. **Click switches selection** — clicking warehouse row N switches to that row's CID, index updated to N
3. **Click search result (CID in warehouse)** — clicking a search result whose CID is in the warehouse list switches to that CID, index updated to its position
4. **Click search result (CID NOT in warehouse)** — clicking a search result whose CID is not in the warehouse list falls back to saved index (not first item); exercises `resolveRequestedWarehouseCid` fallback branch
5. **Same index after refresh (CIDs unchanged)** — data refresh, same index → same position selected
6. **Same index after refresh (CIDs changed)** — data refresh with different items, index in range → same index position selected
7. **Last item when index exceeds list** — data refresh shrinks list below saved index → last item selected
8. **Empty list clears selection** — data refresh returns empty list → selection cleared
9. **Sort keeps CID, syncs index** — sort reorders, selected CID unchanged, index synced to CID's new position
10. **Sort then refresh uses synced index** — sort moves CID to new position → index synced → refresh → new selection follows the synced index (current visual row)
11. **Tab switch preserves CID** — switch away from warehouse then back, CID still in list → same CID selected
12. **Tab switch falls back to index when CID gone** — switch away, data changes removing the CID, switch back → index fallback
