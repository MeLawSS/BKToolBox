# AutoOperation Commands

Overview manual: [`docs/AUTO_OPERATION_MANUAL.md`](./AUTO_OPERATION_MANUAL.md). Use the manual first for stack boundaries, surface differences, and the current `bkcli` / Agent / MetaOperation / AggregateOperation map. This file stays focused on transport and command-contract detail.

This document records the current BKToolBox AutoOperation command protocol implemented by:

- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- `tools/inject/AutoOperation/protocol.h`
- `electron/services/inject-service.js`

## Transport

AutoOperation uses a Windows named pipe:

```text
\\.\pipe\BKAutoOp
```

Each message is sent as one frame:

```text
[4-byte little-endian uint32 payload length][UTF-8 JSON payload]
```

Current runtime limit:

- Agent / JS bridge currently accept AutoOperation frames up to `262144` bytes.
- The larger frame budget is required so `GetStockContainers` can return the
  main warehouse snapshot together with full `boxIds` data.

## Message Shapes

Command request:

```json
{
  "id": "1",
  "cmd": "Ping",
  "args": {}
}
```

Command success response:

```json
{
  "id": "1",
  "ok": true,
  "result": {}
}
```

Command failure response:

```json
{
  "id": "1",
  "ok": false,
  "error": "error message"
}
```

Unsolicited event:

```json
{
  "id": "",
  "event": "Heartbeat",
  "data": {
    "uptime": 30
  }
}
```

Clients must match responses by `id`. Frames with an empty `id` are events and must not be treated as the response to the active command.

## Electron API

BKToolBox exposes AutoOperation through preload:

```js
await window.bidkingDesktop.startAutoOperationAgent();
await window.bidkingDesktop.runAutoOperationCommand(command, args);
```

`startAutoOperationAgent()` injects:

```text
tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
```

and then verifies the agent with `Ping`.

Wait-style UI automation commands currently use a one-shot request/response
bridge as well. Electron derives the named-pipe socket timeout like this:

- no `args.timeoutMs`: `3000 + 1000 = 4000ms`
- `args.timeoutMs` in `100..30000`: `args.timeoutMs + 1000`
- other positive safe integers: currently still passed through as `args.timeoutMs + 1000`, even if Agent-side validation will later reject them
- non-positive / invalid values: fall back to the default `5000ms`

## Commands

### Ping

Checks whether the Agent pipe is reachable.

Request:

```json
{
  "id": "1",
  "cmd": "Ping",
  "args": {}
}
```

Success result:

```json
{
  "pong": true
}
```

### GetCurrentUI

Returns the class name of the current main UI panel by calling the static
`UIBehavior.GetCurShowMainUI()` method.

Request:

```json
{
  "id": "2",
  "cmd": "GetCurrentUI",
  "args": {}
}
```

Success result:

```json
{
  "panel": "TradingExchange_Main"
}
```

Known failure example:

```json
{
  "id": "2",
  "ok": false,
  "error": "UIBehavior class not found"
}
```

### GetVisiblePanels

Returns class names for visible UI behaviours by calling the static
`UIBehavior.GetAllShowedBhvr()` method.

Request:

```json
{
  "id": "3",
  "cmd": "GetVisiblePanels",
  "args": {}
}
```

Success result:

```json
{
  "panels": [
    "TradingExchange_Main",
    "SomeOtherPanel"
  ]
}
```

### OpenPanel

Calls `UIManager.ShowUIByName(string name)`.

Request:

```json
{
  "id": "4",
  "cmd": "OpenPanel",
  "args": {
    "name": "TradingExchange_Main"
  }
}
```

Success result:

```json
{
  "opened": true
}
```

Failure cases include:

- missing `name`
- `UIManager singleton null`
- `ShowUIByName not found`

### ClosePanel

Calls `UIManager.AsyncClosePanel()`.

Request:

```json
{
  "id": "5",
  "cmd": "ClosePanel",
  "args": {}
}
```

Success result:

```json
{}
```

## UI Automation Selector Model

The newer UI automation commands all use the same selector contract:

- `panel`
  - required
  - top-level visible `UIBehavior` class name, resolved from `UIBehavior.GetAllShowedBhvr()`
- `rootPath`
  - optional exact child path under the top-level panel
  - becomes the traversal / matching anchor when present
- `path`
  - required for node commands
  - resolved relative to the active anchor, not relative to the top-level panel when `rootPath` is present
- `pathMode`
  - `exact` or `glob`
  - default: `exact`
- returned `nodes[].path` and `resolvedPath`
  - always relative to the active anchor
  - when `rootPath` is non-empty, results are relative to that `rootPath` subtree

Normalized component names exposed by the protocol are:

- `Button`
- `Toggle`
- `TMP_InputField`
- `NumericInputField`

### DumpPanelTree

Walks one visible panel subtree and returns normalized node snapshots.

Request:

```json
{
  "id": "6",
  "cmd": "DumpPanelTree",
  "args": {
    "panel": "UIMain",
    "rootPath": "WareHousePanel/StorePanel_InfoPane",
    "maxDepth": 4,
    "nodeLimit": 200,
    "interactiveOnly": true,
    "includeInactive": false
  }
}
```

Field defaults and limits:

- `rootPath`: optional, default `""`
- `maxDepth`: default `4`, range `0..8`
- `nodeLimit`: default `200`, range `1..1000`
- `interactiveOnly`: default `true`
- `includeInactive`: default `false`

Success result:

```json
{
  "panel": "UIMain",
  "rootPath": "WareHousePanel/StorePanel_InfoPane",
  "truncated": false,
  "nodes": [
    {
      "path": "InputRoot/PriceInput",
      "name": "PriceInput",
      "depth": 3,
      "active": true,
      "interactive": true,
      "componentTypes": ["TMP_InputField"]
    }
  ]
}
```

Failure cases include:

- `missing panel`
- `invalid panel`
- `invalid rootPath`
- `invalid maxDepth`
- `invalid nodeLimit`
- `panel not visible`
- `panel instance not found`
- `root path not found`
- `dump result too large`

### ClickNode

Resolves one node and invokes a normalized button/toggle click path.

Request:

```json
{
  "id": "7",
  "cmd": "ClickNode",
  "args": {
    "panel": "UIMain",
    "rootPath": "WareHousePanel/StorePanel_InfoPane",
    "path": "BtnSell",
    "pathMode": "exact",
    "component": "auto"
  }
}
```

Field defaults:

- `rootPath`: optional, default `""`
- `pathMode`: `exact` or `glob`, default `exact`
- `component`: `auto`, `button`, or `toggle`; default `auto`
- `component: "auto"` currently prefers `Button`, then falls back to `Toggle`

Success result:

```json
{
  "clicked": true,
  "resolvedPath": "BtnSell",
  "component": "button"
}
```

Failure cases include:

- `missing panel`
- `invalid panel`
- `invalid rootPath`
- `missing path`
- `invalid path`
- `invalid pathMode`
- `invalid component`
- `panel not visible`
- `root path not found`
- `node not found`
- `multiple nodes matched`
- `node inactive`
- `component mismatch`
- `node not clickable`

### SetInputText

Resolves one input node and writes text through normalized TMP / numeric-input
setter paths.

Request:

```json
{
  "id": "8",
  "cmd": "SetInputText",
  "args": {
    "panel": "UIMain",
    "rootPath": "WareHousePanel/StorePanel_InfoPane",
    "path": "InputRoot/PriceInput",
    "pathMode": "exact",
    "text": "7799",
    "submit": true
  }
}
```

Field defaults and limits:

- `rootPath`: optional, default `""`
- `pathMode`: `exact` or `glob`, default `exact`
- `submit`: optional, default `false`
- `text` currently uses a fixed agent buffer and rejects CR, LF, or `"` characters with `text too long`

Success result:

```json
{
  "updated": true,
  "resolvedPath": "InputRoot/PriceInput",
  "component": "tmp-input",
  "text": "7799"
}
```

Failure cases include:

- `missing panel`
- `invalid panel`
- `invalid rootPath`
- `missing path`
- `invalid path`
- `invalid pathMode`
- `missing text`
- `text too long`
- `panel not visible`
- `root path not found`
- `node not found`
- `multiple nodes matched`
- `node inactive`
- `node not input`

### GetNodeState

Reads a normalized UI node state snapshot.

Request:

```json
{
  "id": "9",
  "cmd": "GetNodeState",
  "args": {
    "panel": "UIMain",
    "rootPath": "WareHousePanel/StorePanel_InfoPane",
    "path": "InputRoot/PriceInput",
    "pathMode": "exact"
  }
}
```

Success result:

```json
{
  "resolvedPath": "InputRoot/PriceInput",
  "active": true,
  "interactive": true,
  "text": "7799",
  "toggleOn": false
}
```

Failure cases include:

- `missing panel`
- `invalid panel`
- `invalid rootPath`
- `missing path`
- `invalid path`
- `invalid pathMode`
- `panel not visible`
- `root path not found`
- `node not found`
- `multiple nodes matched`

### WaitForVisiblePanel

Polls until one top-level panel becomes visible or hidden.

Request:

```json
{
  "id": "10",
  "cmd": "WaitForVisiblePanel",
  "args": {
    "panel": "BidPop_Main",
    "visible": true,
    "timeoutMs": 3000,
    "pollIntervalMs": 50
  }
}
```

Field defaults and limits:

- `visible`: default `true`
- `timeoutMs`: default `3000`, range `100..30000`
- `pollIntervalMs`: default `50`, range `16..1000`
- `pollIntervalMs` must not exceed `timeoutMs`

Success result:

```json
{
  "panel": "BidPop_Main",
  "visible": true,
  "waitMs": 187
}
```

Failure cases include:

- `missing panel`
- `invalid panel`
- `invalid timeoutMs`
- `invalid pollIntervalMs`
- panel lookup errors such as `UIBehavior class not found`
- `wait panel timeout`

### WaitForNode

Polls until one node under the active anchor satisfies a minimal state.

Request:

```json
{
  "id": "11",
  "cmd": "WaitForNode",
  "args": {
    "panel": "UIMain",
    "rootPath": "WareHousePanel/StorePanel_InfoPane",
    "path": "InputRoot/PriceInput",
    "pathMode": "exact",
    "state": "interactive",
    "timeoutMs": 3000,
    "pollIntervalMs": 50
  }
}
```

Field defaults and limits:

- `rootPath`: optional, default `""`
- `pathMode`: `exact` or `glob`, default `exact`
- `state`: required, one of `exists`, `active`, `interactive`
- `timeoutMs`: default `3000`, range `100..30000`
- `pollIntervalMs`: default `50`, range `16..1000`
- `pollIntervalMs` must not exceed `timeoutMs`

Success result:

```json
{
  "resolvedPath": "InputRoot/PriceInput",
  "state": "interactive",
  "waitMs": 264
}
```

Current polling semantics:

- missing panel
- unresolved `rootPath`
- missing node

are treated as "not ready yet" during polling and only become a final
`wait node timeout` if the state never becomes true before the deadline.

Immediate failure cases include:

- `missing panel`
- `invalid panel`
- `invalid rootPath`
- `missing path`
- `invalid path`
- `invalid pathMode`
- `missing state`
- `invalid state`
- `invalid timeoutMs`
- `invalid pollIntervalMs`
- panel lookup errors such as `UIBehavior class not found`
- `multiple nodes matched`
- `wait node timeout`

### CollectionPrices

Runs the Agent-side collection price command.

Request:

```json
{
  "id": "6",
  "cmd": "CollectionPrices",
  "args": {}
}
```

Success result:

```json
{
  "items": [
    {
      "cid": 1013007,
      "minPrice": 12345,
      "tierCount": 2,
      "totalCount": 7
    }
  ]
}
```

Current implementation note: this command is separate from the newer `BKPayload64` price-history DLL path. Verify behavior before using it as the canonical price-history collector.

### GetWarehouseItemList

Returns the account-level warehouse item count list by calling:

```text
PlayerManager.GetWareHouseItemList()
```

Request:

```json
{
  "id": "7",
  "cmd": "GetWarehouseItemList",
  "args": {}
}
```

Success result:

```json
{
  "items": [
    {
      "itemCid": 1011001,
      "count": 3
    }
  ],
  "count": 1,
  "source": "PlayerManager.GetWareHouseItemList",
  "missingCount": 0
}
```

The Agent reads `WarehouseItemData` fields through IL2CPP field metadata and
tries `itemCid_` / `itemCid` plus `itemCount_` / `itemCount` / `count`. Item
names are intentionally resolved outside the Agent.

Runtime validation on 2026-06-02 showed this command returns general item table
IDs such as pass EXP, collection value, boxes, trial cards, heroes, emoji, and
skins. It does not return the exchange collectible CIDs used by
`collectibles.json`.

### GetStockCollectibleCounts

Returns collectible-like item counts from stock containers by calling:

```text
PlayerManager.GetAllStocks()
```

The Agent awaits the returned `Task<List<Protodata.StockContainerData>>`, walks:

```text
StockContainerData.stockBoxes_[] -> StockBoxData.item_ -> ItemData.cid_ / count_
```

and aggregates counts by CID.

Request:

```json
{
  "id": "7",
  "cmd": "GetStockCollectibleCounts",
  "args": {}
}
```

Success result:

```json
{
  "items": [
    {
      "itemCid": 1013007,
      "count": 2
    }
  ],
  "count": 154,
  "containerCount": 10,
  "boxCount": 1450,
  "itemCount": 1450,
  "emptyItemCount": 0,
  "missingCount": 0,
  "source": "PlayerManager.GetAllStocks"
}
```

BKToolBox should filter or enrich this result with `collectibles.json` when it
needs only exchange collectibles.

### GetStockContainers

Returns stock-container layout snapshots for the Inject batch stock move panel.
The Agent first calls:

```text
PlayerManager.GetAllStocks()
```

Then it merges that raw stock-box snapshot with:

```text
PlayerManager.GetWareHouseDatas()
```

to recover each container's `width` / `height`, item `pos`, `rotate`, and
occupied `boxIds`.

Layout metadata is read from `PlayerManager.GetWareHouseDatas()` when that
method is available in the current game build. If method lookup fails, the
Agent falls back to `PlayerGameData.wareHouses` and continues building the same
response shape.

If one `WareHouseData` entry still lacks a usable `stockId`, the Agent keeps
that layout temporarily and then reconciles it against the matching raw
`GetAllStocks` container. Current builds may report the main warehouse as
`stockId: 0`, so the Agent treats stock ids as non-negative integers and keeps
that layout once the raw container confirms the identity.

When a `WareHouseData` entry still lacks a valid positive `stockId`, the Agent
tries `WareHouseData.GetStockContainerData()` to recover stock identity. If the
layout is still unresolved, it reconciles that layout against raw
`GetAllStocks()` containers by `stockId`, then by `stockCid`, and then by
overlapping `itemUid`.

Request:

```json
{
  "id": "8",
  "cmd": "GetStockContainers",
  "args": {}
}
```

Success result:

```json
{
  "containers": [
    {
      "stockId": 1,
      "stockCid": 9101,
      "width": 4,
      "height": 3,
      "boxCount": 12,
      "items": [
        {
          "itemUid": "123456789",
          "itemId": 1032006,
          "itemCid": 1032006,
          "count": 1,
          "pos": 0,
          "rotate": false,
          "stockId": 1,
          "boxCount": 4,
          "boxIds": [0, 1, 4, 5],
          "canTrade": true,
          "canSale": true,
          "isLock": false
        }
      ]
    }
  ],
  "count": 1,
  "source": "PlayerManager.GetAllStocks"
}
```

Notes:

- `itemUid` is serialized as a string to avoid precision loss in JS.
- `stockId` is a non-negative integer. The main warehouse can legitimately be
  reported as `0`.
- `boxCount` on each container is `width * height`.
- `boxCount` on each item is `boxIds.length`.
- BKToolBox renderer uses this compact snapshot instead of receiving every cell
  as `{ x, y }`.

### MoveStockItem

Moves one stock item by calling:

```text
PlayerManager.MoveItem(oldStockId, oldSlot, newStockId, newSlot, isRotate)
```

Request:

```json
{
  "id": "9",
  "cmd": "MoveStockItem",
  "args": {
    "oldStockId": 1,
    "oldSlot": 0,
    "newStockId": 2,
    "newSlot": 5,
    "isRotate": false
  }
}
```

Validation:

- `oldStockId` / `newStockId` must be non-negative integers
- `oldSlot` / `newSlot` must be zero or positive
- `isRotate` accepts boolean, or integer fallback `0/1`

Success result:

```json
{
  "moved": true,
  "oldStockId": 1,
  "oldSlot": 0,
  "newStockId": 2,
  "newSlot": 5,
  "isRotate": false,
  "stocksRefreshed": true,
  "containers": [
    {
      "stockId": 1,
      "stockCid": 9101,
      "width": 4,
      "height": 3,
      "boxCount": 12,
      "items": []
    },
    {
      "stockId": 2,
      "stockCid": 9102,
      "width": 4,
      "height": 3,
      "boxCount": 12,
      "items": [
        {
          "itemUid": "123456789",
          "itemId": 1032006,
          "itemCid": 1032006,
          "count": 1,
          "pos": 5,
          "rotate": false,
          "stockId": 2,
          "boxCount": 4,
          "boxIds": [5, 6, 9, 10],
          "canTrade": true,
          "canSale": true,
          "isLock": false
        }
      ]
    }
  ],
  "count": 2,
  "source": "PlayerManager.MoveItem"
}
```

BKToolBox's Inject page batch move panel should use the returned snapshot as
the next authoritative layout before scheduling the next move.

After a successful move, the Agent also calls `PlayerManager.GetAllStocks()` to
refresh the in-game stock cache. If that follow-up refresh does not complete,
`MoveStockItem` still returns the successful move result and marks
`"stocksRefreshed": false` instead of converting the move into an error.

Current limitation: `GetAllStocks()` refreshes the data cache used by
BKToolBox, but on current game builds it does not reliably redraw an already
open in-game warehouse / stock-box page. Manual in-game auto-sort still forces
that UI refresh.

### ExchangeItem

Lists a collectible on the exchange by calling:

```text
PlayerManager.ExchangeItem(itemCid, count, totalPrice)
```

The request uses single-item price. The Agent computes `totalPrice = count * unitPrice`.

Request:

```json
{
  "id": "7",
  "cmd": "ExchangeItem",
  "args": {
    "itemCid": 1011001,
    "count": 1,
    "unitPrice": 12345,
    "timeoutMs": 15000
  }
}
```

`itemId` is accepted as an alias for `itemCid`. `timeoutMs` is optional and clamped to `1000..60000`.

Success result:

```json
{
  "itemCid": 1011001,
  "count": 1,
  "unitPrice": 12345,
  "totalPrice": 12345,
  "result": true,
  "stocksRefreshed": true,
  "exchangeItemsRefreshed": true
}
```

After a successful listing, the Agent also calls `PlayerManager.GetAllStocks()` and
`PlayerManager.GetExchangeItems()` to refresh the local warehouse and exchange
cache. This avoids the stale in-game warehouse state where a listed item remains
visible until a manual sort/refresh action.

Validation failures include:

- `invalid itemCid`
- `invalid count`
- `invalid unitPrice`
- `totalPrice overflow`
- `ExchangeItem task timeout`


### InvokeMethod

Invokes a zero-argument or one-integer-argument method on a singleton-like IL2CPP class.

Current Agent implementation reads these fields from the request JSON:

- `class`
- `method`
- `arg0` optional integer

Request without `arg0`:

```json
{
  "id": "7",
  "cmd": "InvokeMethod",
  "args": {
    "class": "PlayerManager",
    "method": "GetSelfTradeInfo"
  }
}
```

Request with `arg0`:

```json
{
  "id": "8",
  "cmd": "InvokeMethod",
  "args": {
    "class": "PlayerManager",
    "method": "GetProfile",
    "arg0": 123456
  }
}
```

Success result:

```json
{
  "resultClass": "Task`1"
}
```

Limitations:

- The Agent only attempts method lookup by parameter count `0`, then parameter count `1`.
- The one-argument path only supports integer `arg0`.
- The Agent does not await returned `Task` values here; it returns the immediate result object's class name.

### StartDelayedPriceQuery

Schedules one delayed price query for a collectible. The Agent waits an
interruptible randomized delay, then calls:

```text
PlayerManager.GetItemTradeInfo(itemCid)
```

Only one delayed price query can be `scheduled` or `running` at a time.

Request:

```json
{
  "id": "9",
  "cmd": "StartDelayedPriceQuery",
  "args": {
    "itemCid": 1083009,
    "delaySeconds": 600,
    "jitterSeconds": 90
  }
}
```

Validation:

- `itemCid` must be positive.
- `delaySeconds` defaults to `600` and must be `1..86400`.
- `jitterSeconds` defaults to `90` and must be `0..delaySeconds`.

Success result:

```json
{
  "taskId": "delayed-price-1",
  "state": "scheduled",
  "itemCid": 1083009,
  "delaySeconds": 600,
  "jitterSeconds": 90,
  "actualDelaySeconds": 647,
  "remainingSeconds": 647,
  "result": {},
  "error": ""
}
```

The Agent also broadcasts `DelayedPriceQueryUpdated` when the task is scheduled,
starts running, completes, fails, or is canceled.

### GetDelayedPriceQueryStatus

Returns the current delayed price query state.

Request:

```json
{
  "id": "10",
  "cmd": "GetDelayedPriceQueryStatus",
  "args": {}
}
```

Idle result:

```json
{
  "state": "idle"
}
```

Completed result:

```json
{
  "taskId": "delayed-price-1",
  "state": "completed",
  "itemCid": 1083009,
  "delaySeconds": 600,
  "jitterSeconds": 90,
  "actualDelaySeconds": 647,
  "remainingSeconds": 0,
  "result": {
    "itemCid": 1083009,
    "resultClass": "List`1",
    "minPrice": 6200,
    "tierCount": 2,
    "totalCount": 7,
    "tiers": [
      {
        "price": 6200,
        "count": 3
      },
      {
        "price": 6400,
        "count": 4
      }
    ]
  },
  "error": ""
}
```

### CancelDelayedPriceQuery

Cancels the active delayed price query. Cancel is immediate while the task is
waiting; if the query is already running, the command requests cancellation but
does not forcibly terminate an in-flight IL2CPP call.

Request:

```json
{
  "id": "11",
  "cmd": "CancelDelayedPriceQuery",
  "args": {
    "taskId": "delayed-price-1"
  }
}
```

`taskId` is optional. If provided and it does not match the active task, the
Agent returns `taskId mismatch`.

### GetCollectionItemCids

Returns the current user's collected item cids from
`PlayerManager.GetAllCollectionItems()`.

Request:

```json
{
  "id": "12",
  "cmd": "GetCollectionItemCids",
  "args": {}
}
```

Success result:

```json
{
  "cids": [1013007, 1032006],
  "count": 2
}
```

### GetItemTradeInfo

Queries one item's exchange trade tiers through
`PlayerManager.GetItemTradeInfo(itemCid)`.

Request:

```json
{
  "id": "13",
  "cmd": "GetItemTradeInfo",
  "args": {
    "itemCid": 1032006
  }
}
```

Success result:

```json
{
  "itemCid": 1032006,
  "resultClass": "List`1",
  "minPrice": 6200,
  "tierCount": 2,
  "totalCount": 7,
  "tiers": [
    { "price": 6200, "count": 3 },
    { "price": 6400, "count": 4 }
  ]
}
```

### UnloadAgent

Schedules the injected Agent DLL to unload itself.

Request:

```json
{
  "id": "9",
  "cmd": "UnloadAgent",
  "args": {
    "delayMs": 200
  }
}
```

`delayMs` is optional. Current Agent behavior:

- default: `200`
- minimum: `0`
- maximum: `5000`

Before the success response, the Agent broadcasts:

```json
{
  "id": "",
  "event": "AgentUnloading",
  "data": {
    "reason": "command",
    "delayMs": 200
  }
}
```

Success result:

```json
{
  "unloading": true,
  "delayMs": 200
}
```

After the delay, the Agent:

1. marks itself as shutting down;
2. closes current pipe connections;
3. wakes the pipe server loop;
4. waits for Agent and heartbeat threads to exit;
5. calls `FreeLibraryAndExitThread`.

After this command succeeds, connecting to `\\.\pipe\BKAutoOp` should fail until the Agent is injected again.

## Collection Price Scan UI

The Inject page collection price scan panel uses BKToolBox-side orchestration.
The Agent only provides `GetCollectionItemCids` and `GetItemTradeInfo`.
BKToolBox writes `Documents\BKPriceHistory\Cids.json`, per-item CSV history,
ladder JSONL, and `latest.json`.

The Inject page batch stock move panel also uses BKToolBox-side orchestration:
renderer code groups source rows by `itemCid`, lets the user search/filter those
groups, computes target placement from `GetStockContainers`, then expands each
selected group back into concrete item instances, issues sequential
`MoveStockItem` commands, waits `1s` between two actual move commands when more
than one item is moved, continuously updates renderer-side progress
(`processed / total / success / skipped / failed / current item`) after each
skip/success/failure, and always advances from the latest returned snapshot.

The old topbar schedule switch is not part of the new workflow.

## Current Command List

For the higher-level grouping of these commands, plus the current difference between native registration and Inject panel exposure, see [`docs/AUTO_OPERATION_MANUAL.md`](./AUTO_OPERATION_MANUAL.md).

The current dispatch table contains:

```text
Ping
GetCurrentUI
GetVisiblePanels
OpenPanel
ClosePanel
DumpPanelTree
ClickNode
SetInputText
GetNodeState
DescribeNodeComponents
DescribeNodeComponentMethods
DescribeNodeComponentMethodSignatures
DescribeNodeComponentFields
DescribeClassMethodSignatures
CallNodeComponentMethod
InvokeNodeComponentMethod
WaitForVisiblePanel
WaitForNode
CollectionPrices
GetCollectionItemCids
GetWarehouseItemList
GetStockCollectibleCounts
GetStockContainers
MoveStockItem
GetItemTradeInfo
StartDelayedPriceQuery
GetDelayedPriceQueryStatus
CancelDelayedPriceQuery
ExchangeItem
InvokeMethod
LoadProbe
GoToBattlePrev
EnterRoom
OpenSkillConfig
SelectRole
StartAction
GetBidState
PlaceBid
SetBidAmount
ConfirmBid
DismissRewardsBox
DismissCollectAward
GetCurrentScreen
CloseCurrentOverlay
CollectCabinetReward
SetExpectedPrice
AutoAuction
CancelAutoAuction
UnloadAgent
```

When adding a new command, update both:

- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- this document
