# Price Current Item Refresh Design

## Goal

Add a refresh action to the Price tab history panel so the user can query the
currently selected item's latest exchange low price on demand and immediately
update the trend chart.

## Scope

- Refresh only the currently selected item.
- Use the AutoOperation Agent command `GetItemTradeInfo(itemCid)`.
- Record the returned trade tiers through the existing BKToolBox history writer.
- Reload the selected item's history and latest price after a successful refresh.
- Remove the text-only history list below the chart. Keep the chart and summary
  stats.

## Non-Goals

- Do not trigger the full collection scan.
- Do not write price history from the renderer.
- Do not change the chart library or chart rendering behavior.

## UX

The selected item history panel gets a small refresh button in the panel header.
The button is enabled only when a valid selected item exists and the desktop
refresh API is available. While refreshing, the button is disabled and shows a
loading label. On failure, the panel shows a concise error message.

The history text list at the bottom of the panel is removed, so the panel no
longer shows rows like timestamp followed by price. Historical data remains
available through the chart and stats.

## Data Flow

1. Price renderer calls a desktop API with the selected `itemCid`.
2. Electron main ensures the AutoOperation Agent is running.
3. Electron main runs `GetItemTradeInfo` for that `itemCid`.
4. Electron main records the result with `recordTradeInfoSnapshot`.
5. Price renderer reloads:
   - `/api/price-history/latest`
   - `/api/price-history/item/:itemCid?limit=1000`
6. The chart receives the updated history.

## Error Handling

- If no item is selected, the button is unavailable.
- If the Agent cannot start or the command fails, show the returned error.
- If the history writer rejects the result, show the writer error.
- Failed refreshes do not clear the currently displayed chart.

## Testing

- Electron service test verifies the desktop helper starts the Agent, runs
  `GetItemTradeInfo`, records the snapshot, and returns the recorded summary.
- Price page test verifies clicking the refresh button calls the desktop API,
  reloads latest/history, and updates the chart data.
- Price page test verifies the text history list is no longer rendered.
