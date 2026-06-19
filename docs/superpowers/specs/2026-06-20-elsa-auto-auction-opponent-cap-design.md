# Elsa AutoAuction Opponent-Cap Bidding Design

Date: 2026-06-20
Status: Draft for review

## Goal

Refine Elsa `AutoAuction` bidding for rounds 2 through 5 so the script does not blindly follow the existing expected-price multiplier strategy when the opponent's previous-round bid implies a lower safe ceiling.

The new rule is:

- keep the existing round-1 behavior unchanged
- for rounds 2 through 5:
  - compute the existing `originalBid`
  - read the opponent's previous-round bid from the live `Battle_Main` UI
  - compute `opponentCap = floor(opponentPreviousBid * roundMultiplier)`
  - use `min(originalBid, opponentCap)` as the final bid
- if opponent identity or previous-round bid cannot be read reliably, fall back to `originalBid`

## Current Context

Current native bidding behavior already exists in:

- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

Current strategy when `useExpectedPrice = true`:

- round 1: `expectedPrice * 2.0`
- round 2: `expectedPrice * 1.7`
- round 3 and later: `expectedPrice * 1.0`

Current runtime evidence from the live `Battle_Main` playback/battle UI:

- player names are readable at:
  - `Gaming/PlayerContainer/Player_1/NameUnit/NameLayout/nameTxt`
  - `Gaming/PlayerContainer/Player_2/NameUnit/NameLayout/nameTxt`
- per-round bid history is readable at:
  - `Gaming/PlayerContainer/Player_X/containers/RoundUnit.../priceTxt`
- the current user's in-game name is `melo`
- the opponent is therefore defined as the player whose visible name is not `melo`

This means the new strategy can be implemented entirely inside the native `AutoAuction` flow without adding any new IPC command or renderer-side logic.

## User Decisions Captured

- implement this as a native `AutoAuction` strategy change, not an app-side post-processing rule
- keep the current first-round strategy unchanged
- apply the new limit only for rounds 2 through 5
- identify the opponent as the visible player whose name is not `melo`
- if opponent name or previous-round bid is missing or unparsable, fall back to the original strategy
- implement the first version directly inside `CmdAutoAuction`, not as a new standalone strategy module

## Rejected Approaches

### Approach A: App-side adjustment before sending `AutoAuction`

Pros:

- no native strategy changes

Cons:

- app side cannot reliably read live in-battle round history at the exact bid timing
- duplicates battle-state logic outside the agent
- weak fit for current one-shot command architecture

Rejected.

### Approach B: New standalone native strategy module

Pros:

- cleanest long-term separation

Cons:

- heavier than needed for a small rule extension
- adds more surface area than the current requirement justifies

Rejected for this round.

### Approach C: Inline extension in `CmdAutoAuction`

Pros:

- smallest edit surface
- keeps battle UI reads close to existing round/bid timing logic
- fastest path to a working result

Cons:

- continues growing `MetaOperations.cpp`
- some policy logic remains coupled to UI extraction

Chosen for this round.

## Design

### 1. Strategy Semantics

Let:

- `originalBid` be the amount produced by the existing strategy
- `currentRoundNumber` be the in-game round number parsed from `roundTxt`
- `opponentPreviousBid` be the opponent's bid value from `currentRoundNumber - 1`

Then:

- round 1:
  - final bid = `originalBid`
- rounds 2 through 5:
  - compute `opponentCap = floor(opponentPreviousBid * capMultiplierForRound)`
  - final bid = `min(originalBid, opponentCap)`
- round 6 and later:
  - final bid = `originalBid`

Round-specific cap multipliers:

- round 2: `1.65`
- round 3: `1.4`
- round 4: `1.23`
- round 5: `1.1`

### 2. Fallback Rules

The strategy must fall back to `originalBid` when any of the following is true:

- the current round number cannot be parsed as a positive integer
- the current round is not in `2..5`
- neither visible player name can be read
- both visible player names equal `melo`
- the non-`melo` player cannot be determined uniquely
- the opponent previous-round price node is missing
- the opponent previous-round price text is empty
- the opponent previous-round price text cannot be parsed into a positive integer
- the computed `opponentCap` is non-positive

This fallback is deliberate. The rule is an opportunistic limiter, not a hard dependency for bidding.

### 3. Native Implementation Shape

Only `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` changes for the runtime logic.

`AggregateOperationSemantics.h` keeps the existing `ComputeBidAmount()` behavior unchanged. It remains the source of the original expected-price strategy.

Inside `MetaOperations.cpp`, add small local helpers for:

- parsing round text like `第4轮` or `4` into an integer round number
- reading player name text for `Player_1` and `Player_2`
- selecting the opponent slot as the player whose name is not `melo`
- mapping current round number to previous-round `priceTxt` path
- parsing formatted price text like `17,986` into integer `17986`
- returning the round-specific opponent-cap multiplier for rounds 2 through 5

These helpers stay file-local and are used only by `CmdAutoAuction`.

### 4. Bid Flow Integration

The integration point is the existing branch where `CmdAutoAuction` currently does:

1. detect round/time remaining
2. compute `amount`
3. open bid input
4. type `amount`
5. confirm bid

The new flow becomes:

1. compute `originalBid` exactly as today
2. parse `currentRoundNumber`
3. if round is `2..5`, try to read `opponentPreviousBid`
4. if successful, compute `opponentCap`
5. set `amount = min(originalBid, opponentCap)`
6. otherwise set `amount = originalBid`
7. continue with the existing bid input/confirm flow

No other part of the `AutoAuction` navigation, cleanup, cancelation, or pipe protocol changes.

### 5. Logging

Add one high-signal native log line per attempted constrained bid for rounds 2 through 5.

The log should include:

- current round number
- original bid
- opponent name if available
- opponent previous-round bid if available
- cap multiplier if applied
- capped bid if applied
- final bid
- explicit fallback reason when the limiter is skipped

Representative examples:

- `AutoAuction round=3 opponent=澈澈澈 prevBid=44444 multiplier=1.40 originalBid=50000 cappedBid=62221 finalBid=50000`
- `AutoAuction round=4 limiter skipped: opponent previous bid missing; originalBid=75666`

The goal is to make live strategy verification possible from logs without adding any new UI.

## Testing Requirements

### 1. Native Pure/Semi-Pure Tests

Add focused tests for the new helper logic in `AggregateOperationSemantics.test.cpp` or a small adjacent native test file if needed.

At minimum cover:

- round 2 multiplier = `1.65`
- round 3 multiplier = `1.4`
- round 4 multiplier = `1.23`
- round 5 multiplier = `1.1`
- unsupported rounds return "no cap" behavior
- `17,986` parses to `17986`
- empty or malformed price text fails parsing
- final bid chooses the smaller of `originalBid` and `opponentCap`
- fallback path preserves `originalBid`

The existing `ComputeBidAmount()` tests must remain unchanged, because the original strategy primitive is still valid and still used.

### 2. Build Verification

Rebuild `BKAutoOpAgent.dll` and verify the native test executable still passes.

### 3. Live Verification

Use the real game process to confirm:

- both player names can still be read from `Battle_Main`
- both players' previous-round bid texts can still be read from `Battle_Main`
- on a round in `2..5`, the script computes a constrained final bid when opponent data is available
- when opponent data is unavailable, the script still bids using the original strategy
- the new rule does not break `AutoAuction` cancelation or cleanup behavior

## Non-Goals

- no change to the round-1 strategy
- no change to rounds 6+
- no support for configurable self-name in this round; `melo` is hardcoded
- no new app-side controls or Elsa UI changes
- no new preload API or pipe command
- no protocol response shape change for `AutoAuction`

## Files Expected To Change

- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

`AggregateOperationSemantics.h` may stay unchanged unless a tiny helper is clearly better placed there, but the default plan is to keep the new strategy-specific logic inside `MetaOperations.cpp`.
