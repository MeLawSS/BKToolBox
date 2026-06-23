# Monitor Page: Remove Market Sale Panel

**Date:** 2026-06-23
**Scope:** `src/monitor/App.vue`, `src/monitor/App.test.js`, `src/monitor/monitor.css`

## Goal

Remove the "交易所售卖价" panel from the `monitor` page so the page only shows:

- monitor controls
- event list
- selected event detail

The page must stop rendering market sale rows and stop issuing market sale price requests from the `monitor` frontend.

## Non-Goals

- Do not remove backend market price endpoints
- Do not remove `MarketPriceStore` or server-side storage logic
- Do not change event list columns, filters, or detail rendering
- Do not redesign the monitor page beyond reclaiming the removed panel's space

## Current Behavior

`src/monitor/App.vue` currently owns a second data flow besides the monitor event stream:

- `fetchMarketPrices()` loads `/api/market-prices/latest`
- `fetchMarketHistory()` loads `/api/market-prices/history`
- `pushEvent()` refreshes market prices again when an SSE event of type `market_price` arrives
- the template renders a bottom `market-panel` with `#market-price-table` and `#market-price-detail`

That behavior is fully local to the `monitor` page. The backend market price feature exists independently and does not need to be deleted for this UI removal.

## Approaches Considered

### 1. Remove only the panel markup and CSS

This is the smallest visible change, but it leaves dead state, dead fetches, and hidden background work in `src/monitor/App.vue`.

Rejected.

### 2. Remove the monitor page market-panel and its entire frontend data flow

Delete the panel markup, CSS, state, computed values, fetch helpers, mount-time loading, and SSE-triggered market refresh from the `monitor` page only.

This is the chosen approach because it fully matches the requested behavior and leaves no wasted client work behind.

### 3. Keep a reduced market summary instead of the full panel

This would preserve a partial market feature on the page.

Rejected because the requirement is to remove the panel, not compress it.

## Chosen Design

### 1. Remove market sale panel rendering

Delete the bottom `<section class="market-panel">` block from `src/monitor/App.vue`, including:

- the refresh button
- `#market-price-table`
- `#market-price-detail`
- all tier/history rows

After the change, the page layout ends at the existing `#monitor-detail` section.

### 2. Remove monitor-page-only market state and requests

Delete the market-specific frontend state from `src/monitor/App.vue`:

- `marketPrices`
- `selectedMarketItemCid`
- `marketHistory`
- `marketHistoryRequestId`
- `selectedMarketPrice`
- `latestMarketTiers`

Delete the helper functions that exist only for this panel:

- `fetchMarketPrices()`
- `getMarketItemName()`
- `fetchMarketHistory()`
- `selectMarketPrice()`

Delete the `onMounted()` market bootstrap calls:

- keep `fetchDriverStatus()`
- keep `fetchCollectibles()`
- remove `fetchMarketPrices()`

### 3. Stop market-price SSE events from refreshing removed UI

`pushEvent()` currently special-cases `rawEvent.type === 'market_price'` to refresh the market panel.

After removal, keep accepting `market_price` events into the general event list, but remove the special refresh side effect. `pushEvent()` should behave the same way for market-price events as for any other event type.

This preserves event visibility while removing the panel-specific coupling.

### 4. Remove panel-only CSS

Delete unused `market-panel` / `market-detail` / `market-row` styles from `src/monitor/monitor.css`.

Do not reshape unrelated control, results, or detail panel styles unless a tiny spacing cleanup is needed after the panel disappears.

## Acceptance Criteria

1. The `monitor` page no longer renders the "交易所售卖价" panel.
2. `src/monitor/App.vue` no longer requests `/api/market-prices/latest` on mount.
3. Selecting or receiving `market_price` events does not trigger `/api/market-prices/history` requests from the `monitor` page.
4. `market_price` SSE events still appear in the general event list and can still be inspected through the normal event detail panel.
5. The existing monitor controls, event table, and event detail panel behavior remain unchanged.

## Files Expected to Change

- `src/monitor/App.vue`
- `src/monitor/App.test.js`
- `src/monitor/monitor.css`

## Testing

### Automated

Update `src/monitor/App.test.js` to:

1. remove market-panel-specific tests
2. add regression coverage that the page does not render `#market-price-table` or `#market-price-detail`
3. add regression coverage that a `market_price` SSE event still shows up in `#monitor-events`
4. assert that market price API calls are no longer made by the page

### Manual

Verify in the built `monitor` page that:

1. the page ends after the event detail panel
2. no market sale panel is visible
3. normal monitor start/stop and event rendering still work
4. a `market_price` event still appears in the event table as a normal event row
