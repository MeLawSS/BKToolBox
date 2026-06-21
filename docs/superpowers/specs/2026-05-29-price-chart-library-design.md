# Price Chart Library Design

## Goal

Replace the hand-written SVG trend chart on the Price page with a Vue chart component that shows usable X/Y axis ticks, price formatting, and tooltips for historical low-price data.

## Scope

- Add `chart.js@4` and `vue-chartjs@5` as frontend dependencies.
- Create a focused `PriceTrendChart` component for Price history data.
- Keep the existing Price page layout, tabs, stats, history list, and empty states.
- Keep `Documents/BKPriceHistory` API contracts unchanged.
- Do not add zooming, brushing, export, or multi-series comparisons in this change.

## Architecture

`src/price/App.vue` will stop computing SVG polyline points directly. It will pass `selectedHistory` into a new chart component.

The chart component will:

- Accept `history` rows shaped like `{ observedAt, minPrice }`.
- Normalize rows into Chart.js labels and numeric data.
- Use Chart.js `CategoryScale` with preformatted local time labels, not `TimeScale`.
- Render a line chart with visible X and Y tick labels.
- Use localized number/date formatting based on the current language state.
- Recompute chart colors from CSS variables when the app theme changes, then update the chart.

The implementation will register only the Chart.js pieces this chart needs:

- `CategoryScale`
- `LinearScale`
- `PointElement`
- `LineElement`
- `LineController`
- `Tooltip`
- `Filler`

This avoids the larger all-registrables import.

## Data Flow

1. Price page fetches `/api/price-history/item/:itemCid?limit=1000` as it does today.
2. `selectedHistory` updates after an item is selected.
3. `PriceTrendChart` receives the history rows and renders the chart.
4. The existing history list remains below the chart as a textual audit trail.

## UI Behavior

- X axis label remains "时间" / "Time".
- Y axis label remains "价格" / "Price".
- X axis ticks show compact local date/time labels.
- Y axis ticks show localized integer price labels.
- Tooltip shows full local timestamp and formatted minimum price.
- With fewer than two valid points, the existing no-history/empty handling remains visible instead of a misleading chart.
- Up to 1000 returned points are rendered directly in this change. Downsampling is intentionally out of scope until it is shown to be needed.

## Error Handling

Invalid dates and non-numeric prices are filtered out before rendering. If filtering leaves fewer than two points, the chart does not render.

## Testing

- Update Price page tests to assert that selecting an item renders a chart container with X/Y axes from Chart.js configuration rather than the old SVG test IDs.
- Add focused component tests for `PriceTrendChart` covering:
  - valid history renders chart data,
  - invalid or insufficient history renders nothing,
  - axis titles use localized text.
- Mock `vue-chartjs` in Vitest component tests. `happy-dom` does not provide a real Canvas context, so tests should assert the props/config passed to the mocked Line component instead of instantiating Chart.js against a real canvas.

## Verification

- `npm test`
- `npm run build:price`
