# High-Price Exchange Listing Design

## Goal

Build a high-price-first listing advisor for BidKing collectibles. The advisor should use complete exchange price tiers over a 12-24 hour observation window to decide whether an item should be listed, when it should be listed, and at what price. Listing execution remains manually confirmed in the first version.

The system must avoid low-confidence relisting because listing has a non-refundable fee and unsold listings expire after 24 hours.

## Current Capabilities

BKToolBox can already:

- Query exchange trade info through `PlayerManager.GetItemTradeInfo(itemCid)`.
- Read `S2C_59_get_exchange_item_trade_info.TradeInfoList`.
- List items through `PlayerManager.ExchangeItem(itemCid, count, totalPrice)`.
- Refresh local stock/exchange state after listing through `GetAllStocks()` and `GetExchangeItems()`.

The current price-history path stores mostly minimum price. This design requires storing the full price ladder from `TradeInfoList`, where each tier contains:

```json
{ "price": 6200, "count": 2 }
```

## Hard Constraints

### Listing Expiration

Listings expire after 24 hours if not sold. A suggested listing price must therefore be judged against the chance of selling within the next 24 hours, not only against current price.

### Listing Cost

Listing fee is paid when listing and is not refunded if the item expires or is delisted.

### Trade Tax

Trade tax reduces final revenue when the item sells.

### Net Revenue Floor

For one item:

```text
netRevenuePerItem = listingPrice - listingFeePerItem - tradeTaxPerItem
```

A listing is never recommended or submitted when:

```text
netRevenuePerItem < basePrice
```

For multiple items:

```text
netRevenueTotal = unitPrice * count - listingFeeTotal - tradeTaxTotal
```

The equivalent per-item net revenue must still be at least the collectible base price.

## Data Model

Each market observation stores the full price ladder:

```json
{
  "itemCid": 1083009,
  "observedAt": "2026-06-01T10:00:00.000Z",
  "tiers": [
    { "price": 6200, "count": 1 },
    { "price": 6400, "count": 2 },
    { "price": 7800, "count": 1 }
  ]
}
```

The first implementation stores full ladders as one JSONL file per item:

```text
Documents\BKPriceHistory\ladders\<itemCid>.jsonl
```

This layout supports efficient reads for one item over the latest 12-24 hours and keeps it separate from existing minimum-price CSV files.

Current implementation writes and reads the full ladder JSONL files at the same path:

```text
Documents\BKPriceHistory\ladders\<itemCid>.jsonl
```

## Observation Window

The default decision window is 12-24 hours.

The advisor should not make a high-confidence recommendation from a single snapshot unless explicitly marked as low-confidence. The default recommendation engine uses the latest 12-24 hours of observations.

## Derived Metrics

For each item, compute:

- `minPriceMedian`: median of observed minimum prices.
- `minPriceP80`: 80th percentile of observed minimum prices.
- `minPriceP90`: 90th percentile of observed minimum prices.
- `totalListedTrend`: whether total listed count is rising, flat, or falling.
- `lowTierSurvivalMinutes`: how long low-price tiers tend to remain visible.
- `lowTierChurn`: how often low-price tiers disappear or change.
- `stableGaps`: repeated price gaps that appear across several observations.
- `staleHighTiers`: high-price tiers that remain unchanged for most of the window.
- `sellThrough24h`: estimated probability that the suggested price sells before expiration.
- `expirationRisk`: `low`, `medium`, or `high`.

The first version can use heuristic scoring instead of statistical modeling. The score must be explainable in the UI.

## Listing Timing

The advisor has four states:

- `list_now`: high-price opportunity is strong enough to list now.
- `wait`: price is promising but timing is not good enough.
- `probe`: item has multiple owned copies and a small high-price test listing is reasonable.
- `do_not_list`: expected result is poor or violates a hard constraint.

`list_now` requires all of:

- Net revenue per item is at least base price.
- Estimated 24-hour sell-through is at least `0.55` for the high-price profile.
- Low-price tiers disappear quickly rather than sitting unchanged.
- Low-price supply is thinning or stable, not building up.
- A stable upward price gap exists.
- The target price is not anchored to a stale high tier.

`wait` is used when:

- A price gap exists but has not persisted long enough.
- Low-price supply is still heavy.
- The sell-through estimate is uncertain.

`do_not_list` is used when:

- Net revenue per item is below base price.
- Low-price tiers persist for many hours.
- Total supply is rising.
- The target price is near a stale high tier.
- The expected 24-hour expiration risk is too high.

## Pricing Rule

The preferred price is near the upper edge of a stable price gap, but below stale or crowded high-price tiers.

Example:

```text
6200 x 1
6400 x 2
7800 x 1
```

If the `6400 -> 7800` gap is stable and the `7800` tier is not stale, a candidate price can be `7799`.

The candidate price is then clamped by:

- Net revenue floor.
- Recent 24-hour price percentiles.
- Stale high-tier detection.
- Configured maximum aggressiveness.

If the resulting candidate cannot pass the hard constraints, the advisor returns `do_not_list`.

The listing fee configuration is read from:

```text
Documents\BidKing\listing-fee-config.json
```

## Expected Value

For a candidate price, compute:

```text
soldNetRevenue = unitPrice - listingFeePerItem - tradeTaxPerItem
expectedNetRevenue = sellThrough24h * soldNetRevenue - (1 - sellThrough24h) * listingFeePerItem
```

This value is used for ranking and explanation. The hard floor still uses `soldNetRevenue >= basePrice`, because the user does not want a successful sale below base value after fee and tax.

## UI Output

For each selected item, show:

- Item name, quality, CID, and base price.
- Latest full price ladder.
- 12-24 hour trend summary.
- Suggested state.
- Suggested unit price when applicable.
- Listing fee, trade tax, and net revenue per item.
- `sellThrough24h` estimate.
- Expiration risk.
- Human-readable reason.

Example:

```text
进气歧管
State: list_now
Suggested price: 7799
Confidence: high
Reason: low tiers disappear quickly, total supply is down, 6400->7800 gap is stable, and the target tier is not stale.
Net revenue per item after fee and tax: 7097
Base price: 4208
Expiration risk: medium
```

The renderer obtains current advice from:

```text
/api/exchange-listing-advice/:itemCid
```

## Listing Execution

The first version requires manual confirmation before listing.

When the user confirms:

1. Re-fetch the latest market ladder for the item.
2. Re-run the advisor.
3. Abort if hard constraints now fail.
4. Submit `ExchangeItem`.
5. Refresh stocks and exchange listings.
6. Write a listing log row.

This avoids submitting stale advice when the market changes between viewing and clicking.

The current desktop helper for this flow is `confirmHighPriceExchangeListing`. It re-fetches advice, guards on `state === "list_now"` and visible-price match, submits `ExchangeItem`, and writes the listing log. If log writing fails after a successful listing, the successful listing result is still returned with `logError`.

## Listing Log

Every successful guarded listing submission writes one JSON line to:

```text
Documents\BidKing\exchange-listings.jsonl
```

Example:

```json
{
  "observedAt": "2026-06-01T18:30:00.000Z",
  "itemCid": 1083009,
  "name": "进气歧管",
  "count": 1,
  "unitPrice": 7799,
  "totalPrice": 7799,
  "basePrice": 4208,
  "listingFee": 390,
  "tradeTax": 312,
  "netRevenuePerItem": 7097,
  "minimumSafePrice": 4900,
  "sellThrough24h": 0.62,
  "expirationRisk": "medium",
  "strategy": "high_price_stable_gap",
  "confidence": "high",
  "reason": "Low tier churn is fast; 6400->7800 gap is stable; supply is down.",
  "marketSnapshot": [
    { "price": 6200, "count": 1 },
    { "price": 6400, "count": 2 },
    { "price": 7800, "count": 1 }
  ],
  "result": {
    "ok": true,
    "stocksRefreshed": true,
    "exchangeItemsRefreshed": true
  }
}
```

The log is required for debugging and later strategy tuning.

Generic AutoOperation `ExchangeItem` remains available, but advisor-driven listing should use `confirmHighPriceExchangeListing` so the net revenue floor and stale-market revalidation are applied.

## Automation Boundaries

Initial version:

- Full ladder history collection.
- Advisor calculation.
- Manual listing confirmation.
- Listing log.

Not in initial version:

- Fully automatic warehouse scanning and listing.
- Automatic delist/relist.
- High-frequency price chasing.

Future versions may add conservative relisting advice, but only when expected improvement covers sunk listing fees, new listing fees, trade tax, and expiration risk.

## First-Version Decisions

- Listing fee calculation must come from the game's existing configuration or UI calculation path. Hard-coded guesses are not acceptable for listing execution.
- Trade tax calculation must come from the game's existing configuration or UI calculation path. Hard-coded guesses are not acceptable for listing execution.
- Full ladder history is stored as one JSONL file per item in the first version, because the advisor reads one item at a time over the latest 12-24 hours.
- `sellThrough24h` starts as an explainable heuristic score normalized to `0..1`. It is not treated as a calibrated probability until listing logs provide enough outcome data.
