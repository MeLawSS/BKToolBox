# Average Price Combo Cell Spacing

## Goal

When Ethan streams average-price combo results, keep the result table focused by hiding near-duplicate combo rows whose total cell counts are too close to rows already shown.

## Behavior

- Applies only to streamed average-price combo rows, the path that parses solver output lines such as `TotalCells=...`.
- A candidate row is shown only when its `TotalCells` differs by at least 4 from every already displayed average-price combo row.
- The first valid row is always shown.
- The solver request and search limit stay unchanged; filtering is a UI-side display rule.
- Existing exact duplicate filtering by `TotalCells` is retained as a special case of the spacing rule.

## Testing

- Add an App-level regression test that streams rows with close `TotalCells` values and verifies only rows spaced by at least 4 cells are shown.
- Keep the existing 15-row display cap behavior covered.
