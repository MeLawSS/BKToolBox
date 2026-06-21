# Market Price Trends Design

## Goal

Build passive BidKing market price trend tracking from already-captured `market_price` TCP events. The feature records each observed trading-page sale listing snapshot per collectible and shows recent price history in the app.

## Non-Goals

- Do not use market sale prices in Ethan or Ahmed game-value estimation.
- Do not overwrite collectible base prices from unpacked game data.
- Do not actively send game TCP requests in this phase.
- Do not automate game UI clicks in this phase.
- Do not inject into or hook the BidKing process in this phase.

## Terminology

- **Game estimate price:** The value used by BidKing match estimation and existing Ethan/Ahmed logic.
- **Market sale price:** The trading-page listing price parsed from `msgId=59`. This is a separate market signal and must be labeled as sale/listing price in UI.
- **Snapshot:** One observed `market_price` event for one `itemCid` at one capture time.
- **Tier:** One price level inside a snapshot, shaped as `{ price, count }`.

## Data Source

Parser commit `63e916d` emits `market_price` events:

```json
{
  "type": "market_price",
  "key": "market:1022001:1374370655",
  "msgId": 59,
  "sourceKind": "market_price_list",
  "clientMsgId": 1374370655,
  "itemCid": 1022001,
  "requestUid": "1247189784563310",
  "prices": [{ "price": 1155, "count": 105 }],
  "minPrice": 1155,
  "maxPrice": 1502,
  "totalCount": 355
}
```

The live monitor already passes parsed events through `BidKingLiveMonitor.emitParsedEvent()`. In this phase, `market_price` should remain a raw/recent event and also be appended to a dedicated market price store.

## Persistence

Add a file-backed market price store under the app runtime log directory:

- Directory: `<runtime-log-dir>/market-prices/`
- Snapshot log: `<runtime-log-dir>/market-prices/snapshots.ndjson`
- Latest index: `<runtime-log-dir>/market-prices/latest.json`

Each NDJSON snapshot line:

```json
{
  "observedAt": "2026-05-28T12:24:37.000Z",
  "itemCid": 1022001,
  "itemName": "急救毯",
  "requestUid": "1247189784563310",
  "clientMsgId": 1374370655,
  "minPrice": 1155,
  "maxPrice": 1502,
  "totalCount": 355,
  "tierCount": 8,
  "tiers": [
    { "price": 1155, "count": 105 },
    { "price": 1194, "count": 9 }
  ],
  "source": "tcp-passive"
}
```

`latest.json` is a compact object keyed by item cid:

```json
{
  "1022001": {
    "observedAt": "2026-05-28T12:24:37.000Z",
    "itemCid": 1022001,
    "itemName": "急救毯",
    "minPrice": 1155,
    "maxPrice": 1502,
    "totalCount": 355,
    "tierCount": 8,
    "source": "tcp-passive"
  }
}
```

The store should append snapshots before updating the latest index. If writing `latest.json` fails after the append succeeds, the snapshot log remains the durable source of truth.

## Deduplication

Deduplicate exact duplicate snapshots before writing:

- Key: `itemCid + observedAt second + minPrice + maxPrice + totalCount + tiers signature`
- Tier signature: ordered `price:count` joined by `|`

Do not deduplicate by `clientMsgId` alone because the same item can be requested repeatedly and should form a trend over time.

## Enrichment

When tables are available, enrich snapshots with `itemName` from collectible metadata. If the name is missing, store `itemName: null` and still persist the snapshot.

Do not mutate the parsed raw event. Store enrichment only in market price storage and UI view models.

## Live Monitor Integration

Add a small market price store module, for example `lib/bidking-market-price-store.js`, with these responsibilities:

- Normalize a raw `market_price` event into a snapshot.
- Append valid snapshots to `snapshots.ndjson`.
- Maintain `latest.json`.
- Read latest snapshots for API/UI.
- Read recent history for one item with a configurable limit.

`BidKingLiveMonitor.emitParsedEvent()` should call the store only when `rawEvent.type === 'market_price'`.

`buildBidKingMonitorFacts()` should continue returning no facts for market price events. This keeps market sale prices out of gameplay facts and estimation inputs.

## API

Add read-only endpoints:

- `GET /api/market-prices/latest`
  - Returns latest snapshot summary for all observed items.
- `GET /api/market-prices/history?itemCid=1022001&limit=100`
  - Returns recent snapshots for one item, newest last or newest first consistently documented in response.

No write API is needed in this phase because writes come from passive monitor capture.

## UI

Add a market price section to the Monitor page first, not Ethan/Ahmed.

Recommended layout:

- A compact table named “交易行售卖价”.
- Columns:
  - 藏品
  - 最近最低价
  - 最高价
  - 挂单总数
  - 档位数
  - 最近更新时间
- Selecting a row opens details below the table:
  - Latest tier table: 售卖价 / 挂单数量
  - Recent snapshot history: 时间 / 最低价 / 最高价 / 挂单总数

Market price events may also remain visible in the existing raw monitor events table. The dedicated section is the primary UX for trend tracking.

All UI labels must use “售卖价” or “交易行价格”, not “估价”.

## Future Extension Points

This design intentionally leaves room for active price collection without coupling it to the first phase:

- Add `source: "tcp-active"` if BKToolBox later sends valid market requests itself.
- Add `source: "ui-automation"` if a future version automates game UI interactions.
- Add request scheduling and per-item freshness policies later.
- Add charting later based on `snapshots.ndjson`.

No future active collection path should bypass the same market price store. The store is the boundary between acquisition method and UI/history features.

## Testing

Unit tests:

- Normalizes a `market_price` event into a snapshot.
- Rejects events without `itemCid` or without price tiers.
- Appends snapshots and updates latest index.
- Deduplicates exact duplicate snapshots.
- Leaves `buildBidKingMonitorFacts(marketPriceEvent)` empty.

Integration tests:

- `BidKingLiveMonitor` persists a market price event emitted by parser output.
- Monitor UI renders latest market price rows and a selected item’s tiers/history.

## Done When

- Passive monitor capture records `market_price` snapshots to disk.
- Latest market price summaries survive app restart.
- Monitor UI can display latest observed sale prices and recent history per collectible.
- Ethan/Ahmed estimation behavior is unchanged.
- Tests cover store normalization, persistence, deduplication, and UI rendering.
