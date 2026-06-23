# Price Page: Unified Panel Height on Desktop

**Date:** 2026-06-23
**Scope:** `src/price/App.vue`, `src/price/price.css`, `src/price/App.test.js`

## Goal

Keep the left-side primary panel on the `price` page at a stable desktop height across all three tabs:

- `opportunities`
- `collections`
- `warehouse`

When the warehouse list contains many rows, it must stop growing vertically and scroll internally instead of pushing the lower detail panel downward.

## Approved Constraints

- Apply the fixed-height behavior to all three left-side tabs, not only `warehouse`
- Scroll only the table region inside the left-side panel
- Keep the panel header visible while rows scroll
- Apply the fixed-height behavior on desktop only
- Keep mobile single-column layout naturally flowing

## Non-Goals

- Do not move or redesign the three-column page structure
- Do not change warehouse selection, sorting, search, or listing behavior
- Do not make the search panel or detail panel independently scroll-locked
- Do not introduce a mobile double-scroll layout

## Current Behavior

`src/price/App.vue` renders the page as:

1. left-side primary panel (`.opportunity-panel`)
2. right-side search panel (`.search-panel`)
3. lower full-width detail panel (`.detail-panel`)

The left-side panel already wraps its table in `.table-wrap`, and `.table-wrap` already has:

```css
max-height: 560px;
overflow: auto;
```

But the desktop grid row itself is still auto-sized. When the warehouse tab content becomes taller than expected, the first grid row grows, which shifts the lower detail panel downward.

## Approaches Considered

### 1. Unified left-panel height plus internal table scrolling

Make the desktop left-side panel a fixed-height flex container. Let the header keep its natural height, and let `.table-wrap` consume the remaining space and scroll.

This is the chosen approach because it solves the detail-panel shifting problem without changing structure or behavior.

### 2. Fixed first grid-row height

Set the first `price-layout` row to a fixed height and make both the left panel and search panel conform to it.

Rejected because it couples the search panel to the same height budget even though the problem is only the left-side primary panel.

### 3. Warehouse-only height cap

Limit height only for the warehouse tab.

Rejected because the approved behavior is to keep all three tabs visually stable, not only the busiest one.

## Chosen Design

### 1. Desktop-only fixed height for the left primary panel

At desktop widths only, give `.opportunity-panel` a single stable height so the top row of the page no longer changes height between tabs or as warehouse rows increase.

Use one shared desktop constant for this panel height:

```css
--price-primary-panel-height: 640px;
```

Applied only above the existing mobile collapse breakpoint.

### 2. Convert the left primary panel into a vertical flex container

On desktop:

```css
.opportunity-panel {
  display: flex;
  flex-direction: column;
  height: var(--price-primary-panel-height);
}
```

This keeps the panel shell stable while allowing the table region to absorb overflow.

### 3. Keep the header natural, scroll only the table body region

Keep `.opportunity-panel header` as a non-growing block and make `.table-wrap` fill the remaining height:

```css
.opportunity-panel header {
  flex: 0 0 auto;
}

.opportunity-panel .table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow: auto;
}
```

`min-height: 0` is required so the flex child can actually shrink and scroll instead of forcing the parent taller.

### 4. Preserve sticky table headers

The existing sticky header behavior stays in place:

```css
th {
  position: sticky;
  top: 0;
}
```

Because scrolling remains on `.table-wrap`, headers continue to pin inside the left panel while rows move underneath.

### 5. Leave the search and detail panels structurally unchanged

The search panel remains in the right column and the detail panel remains below the first row. The fix is successful when the left primary panel height is stable enough that the detail panel no longer shifts vertically when the warehouse table grows or when the user switches tabs.

### 6. Keep mobile behavior unchanged

At the existing single-column breakpoint (`max-width: 980px`), do not apply the fixed desktop height. The left panel returns to natural document flow so the page does not become cramped or introduce nested scrolling on small screens.

## Acceptance Criteria

1. On desktop, the lower detail panel does not move downward when the warehouse tab contains many rows.
2. On desktop, switching between `opportunities`, `collections`, and `warehouse` keeps the left primary panel at the same height.
3. On desktop, overflow in the left-side list is handled by scrolling inside the table region only.
4. On desktop, the header area of the left panel remains visible while table rows scroll.
5. Search panel behavior and detail panel behavior remain unchanged.
6. On mobile, the page remains single-column and naturally scrolls as before.

## Files Expected to Change

- `src/price/price.css`
- `src/price/App.test.js`

`src/price/App.vue` is expected to remain structurally unchanged unless a minimal class hook is needed during implementation.

## Testing

### Automated

Keep `src/price/App.test.js` green and add only lightweight regression coverage that:

1. confirms all three tabs still render their expected panel
2. confirms the warehouse tab still renders the table container and detail panel together
3. avoids pixel-height assertions, because `happy-dom` is not a trustworthy source for real layout measurements

### Manual

Verify in a browser at desktop width:

1. open the `warehouse` tab with enough rows to overflow
2. confirm the left panel height stays fixed
3. confirm the table region scrolls internally
4. confirm the detail panel top edge does not move while the row count changes or while switching tabs
5. confirm mobile width still collapses to a natural single-column flow

## Implementation Note

At the time this spec was written, the active isolated worktree branch does not yet contain `src/price/*`. The current `price` page implementation exists as uncommitted work in the main workspace at `A:\BidKing`.

The implementation plan must account for that before coding begins:

1. either port the current `src/price/*` work into an isolated worktree branch first
2. or proceed in the main workspace only if the user explicitly chooses that tradeoff
