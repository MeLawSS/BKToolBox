# Elsa AutoAuction Global Bid Cap Design

**Goal:** Add one hard global bid ceiling to native `AutoAuction` so the amount finally submitted into the bid dialog never exceeds `150000`.

## Current Facts

1. Elsa `AutoAuction` currently computes a per-round bid amount inside native `CmdAutoAuction()` in `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`.
2. That amount may already be adjusted by existing logic before submission:
   - expected-price / legacy bid selection
   - opponent-cap limiter
   - bid-dialog readiness checks
   - pre-submit `priceUpperLimit` toggle handling
3. The actual number sent to the game is the `amount` that is eventually written into `InputDevice/Panel1/InputField (TMP)`.

## Decision

Use a **final-submit cap**:

- Keep all existing bid computation logic unchanged.
- After the current bid pipeline finishes producing the round's `amount`, clamp it to `150000` immediately before writing it into the bid input.
- Do not change protocol shape, renderer behavior, room flow, or existing feature flags.

## Rejected Alternatives

### 1. Cap the raw expected-price strategy earlier

Rejected because it changes intermediate strategy semantics and would distort opponent-cap logging and comparison behavior.

### 2. Add a renderer-side cap before sending expected price

Rejected because the final submitted amount is decided in native `AutoAuction`, not in the renderer. App-side capping would not fully guard legacy/native-only paths.

## Implementation Details

### 1. Add a tiny pure helper

Add a small helper in `AggregateOperationSemantics.h`:

- `ResolveAutoAuctionFinalBidAmount(int computedAmount, int maxAmount) -> int`

Rules:

- if `computedAmount <= 0`, return `computedAmount` unchanged
- otherwise return `min(computedAmount, maxAmount)`

For this feature, `maxAmount` is hard-coded to `150000`.

### 2. Clamp only the final amount used for submission

Inside `CmdAutoAuction()`:

1. Keep the existing amount computation path unchanged.
2. After opponent-cap logic has produced the round's effective `amount`, derive:
   - `const int finalAmount = ResolveAutoAuctionFinalBidAmount(amount, 150000);`
3. Use `finalAmount` for:
   - writing into `InputDevice/Panel1/InputField (TMP)`
   - the rest of the same-round submit flow
4. Do not rework the existing round-advancement or cleanup logic.

### 3. Logging

If the cap changes the amount, native log lines should make that visible. Minimal acceptable form:

- include both the pre-cap amount and the final submitted amount

This preserves operator debuggability when a round is clipped by the global ceiling.

## Non-Goals

- no new IPC arguments
- no configurable cap value
- no renderer/UI setting for the cap
- no change to legacy `bidAmount` command semantics outside `AutoAuction`

## Testing

### Native helper test

Extend `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` with:

- unchanged when below cap: `149999 -> 149999`
- exact boundary: `150000 -> 150000`
- clamped when above cap: `150001 -> 150000`
- non-positive passthrough: `0 -> 0`

### Build verification

Re-run:

- `AggregateOperationSemantics.test.cpp`
- `MetaOperations.test.cpp`
- `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

## Acceptance Criteria

1. Any `AutoAuction` round that would previously submit more than `150000` now submits exactly `150000`.
2. Any round at or below `150000` is unchanged.
3. Existing opponent-cap, insurance-toggle, cleanup, and authcode-stop behavior remain unchanged.
4. No protocol or renderer changes are required.
