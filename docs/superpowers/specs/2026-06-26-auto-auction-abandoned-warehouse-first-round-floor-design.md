# Auto Auction Abandoned Warehouse First-Round Floor Design

## Goal

When `AutoAuction` is started with room `102` (`废弃仓库`), the first observed round should enforce a minimum bid floor of `30000` instead of the current shared `17000`.

## Non-Goals

- Do not change the first-round floor for any room other than `102`.
- Do not change any non-first-round bidding behavior.
- Do not change `bidAmount`, expected-price logic, retry timing, or opponent-cap logic.
- Do not change room option labels, room ids, or UI wording in this round.
- Do not introduce user-configurable first-round floor settings.

## Current Context

### Existing room selection

The room selector already exposes:

- `101` = `快递盲盒堆`
- `102` = `废弃仓库`
- other room ids unchanged

This mapping is currently defined in [`src/inject/room-options.js`](../../../src/inject/room-options.js) and consumed by the inject panel.

### Existing first-round floor logic

`AutoAuction` currently clamps the first observed round through:

1. [`tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`](../../../tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp)
2. [`tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`](../../../tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h)

The current call site passes a shared hard-coded floor:

```cpp
amount = ClampAutoAuctionFirstRoundBid(amount, roundsEncountered, 17000);
```

That means all rooms currently use the same `17000` first-round minimum.

## Chosen Approach

Introduce a tiny semantics helper that resolves the first-round floor from `roomId`:

- return `30000` for `roomId == 102`
- return `17000` for every other room

Then update the `MetaOperations.cpp` bid loop to call that helper before the existing first-round clamp.

## Why This Approach

This keeps the room-specific rule in the shared auto-auction semantics layer rather than burying it in the bid-loop call site.

That gives two benefits without broadening scope:

- the rule is testable as a pure helper
- future room-specific floors, if ever needed, have one obvious place to live

Directly hard-coding `roomId == 102 ? 30000 : 17000` at the call site would also work, but it would mix room policy into the runtime loop and make semantics tests less direct.

## Architecture

### 1. Semantics helper

Add a helper in [`AggregateOperationSemantics.h`](../../../tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h) that returns the floor for a given `roomId`.

Expected behavior:

- `102` -> `30000`
- any other room id -> `17000`

### 2. Runtime call site

Update [`MetaOperations.cpp`](../../../tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp) so the existing first-round clamp becomes:

1. resolve room-specific first-round floor
2. pass that floor into `ClampAutoAuctionFirstRoundBid(...)`

No other bid-loop behavior should change.

## Matching Rule

The new `30000` minimum must apply only when all of the following are true:

- command is `AutoAuction`
- selected `roomId` is `102`
- `roundsEncountered == 1`
- computed bid amount is below `30000`

It must not apply when:

- room is any id other than `102`
- the observed round is not the first round
- the computed amount is already `30000` or above

## Testing Strategy

Follow TDD.

### 1. Semantics tests

Extend [`AggregateOperationSemantics.test.cpp`](../../../tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp) first with failing assertions for:

- `ResolveAutoAuctionFirstRoundFloorAmount(102) == 30000`
- `ResolveAutoAuctionFirstRoundFloorAmount(101) == 17000`
- `ResolveAutoAuctionFirstRoundFloorAmount(103) == 17000`

Also add a clamp regression proving the `30000` floor is only used for room `102` on the first round.

### 2. Runtime integration surface

No UI test is required if the runtime still passes the selected numeric `roomId` unchanged and the bid-loop call site only switches from a literal floor to the helper result.

The existing room-selection UI contract already covers `102` as a valid selected room, so this round can stay focused on semantics plus the runtime call site.

## Verification Commands

Implementation-phase verification should at minimum include:

- the project-specific compile/test command for `AggregateOperationSemantics.test.cpp`
- any targeted desktop/inject verification command needed to ensure `MetaOperations.cpp` still builds cleanly
- `git diff --check`

If the existing repo workflow uses a broader targeted test command for `tools/inject/AutoOperation`, use that exact command in the implementation plan.

## Risks And Boundaries

### Risk: silently affecting other rooms

Mitigation:

- resolve the floor from `roomId` in one helper
- assert explicit non-`102` examples in tests

### Risk: accidentally changing later rounds

Mitigation:

- keep all room logic separate from `ClampAutoAuctionFirstRoundBid(...)`
- leave the existing `roundsEncountered == 1` condition untouched

## Done When

- `AutoAuction` uses `30000` as the first-round minimum for room `102`
- all other rooms still use `17000` as the first-round minimum
- later rounds behave exactly as before
- targeted semantics/runtime verification passes
