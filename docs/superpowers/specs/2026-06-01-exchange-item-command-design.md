# Exchange Item Command Design

## Goal

Add an AutoOperation command and Inject-page controls for listing a collectible on the exchange by name or CID, count, and single-item price.

## Command Contract

The Agent command is `ExchangeItem`.

Request args:

```json
{
  "itemCid": 1011001,
  "count": 1,
  "unitPrice": 12345,
  "timeoutMs": 15000
}
```

`itemId` is accepted as an alias for `itemCid`. The Agent computes `totalPrice = count * unitPrice` and invokes:

```text
PlayerManager.ExchangeItem(itemCid, count, totalPrice)
```

The command waits for the returned `Task<bool>` and reports the final boolean result.

## UI

The Inject page adds a dedicated exchange-listing panel under AutoOperation Agent. The item input accepts a collectible name or raw numeric CID. Name input filters a candidate list from `public/data/collectibles.json`.

Candidates display name, quality, type, size, base price, and CID. Ambiguous names require selecting one candidate before submission.

## Catalog

`scripts/extract-bidking-collectibles.js` will include `itemCid` in generated collectible records so UI code can map names to protocol IDs without parsing table files at runtime.

## Validation

Frontend and Agent both reject non-positive `count` or `unitPrice`. The Agent rejects `totalPrice` overflow beyond signed int32. Server-side ownership and stock validation remain authoritative.
