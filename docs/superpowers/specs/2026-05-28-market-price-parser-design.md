# Market Price Parser Design

## Goal

Parse BidKing trading-page price list traffic from the existing TCP monitor path. Captured evidence shows the trading page uses the game long connection on port 10000:

- upstream `msgId 58`: requests price listings for one collectible cid
- downstream `msgId 59`: returns repeated price tiers for that request

## Scope

This change only adds parser support and structured events. It does not change Ethan/Ahmed UI, estimation logic, or stored collectible data.

## Data Model

Add a `market_price` realtime event:

- `itemCid`: collectible cid from the paired `msgId 58`
- `requestUid`: field 1 from `msgId 58`
- `prices`: ordered list of `{ price, count }`
- `minPrice`, `maxPrice`, `totalCount`
- `clientMsgId`: used to pair request and response

If a `msgId 59` response cannot be paired with a request, keep the parsed prices and set `itemCid` to `null`.

## Parsing

`msgId 58` payload is protobuf varints:

- field 1: request/user uid
- field 2: item cid

`msgId 59` payload is repeated field 2 messages:

- child field 1: price
- child field 2: listing count

## Tests

Add parser tests that build upstream `msgId 58` and downstream `msgId 59` frames with the observed payload shape, then assert that `extractBidKingRealtimeEvents` returns the market price event.
