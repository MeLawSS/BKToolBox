# Elsa AutoAuction Opponent-Cap Bidding Design

Date: 2026-06-20
Status: Draft for review

## Goal

Refine Elsa `AutoAuction` bidding for rounds 2 through 5 so the script does not blindly follow the existing expected-price multiplier strategy when the opponent's previous-round bid implies a lower overpay cap.

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

Current runtime evidence comes from a live `bkcli` probe against the running game session on 2026-06-20, not from static source grep:

- player names were readable at:
  - `Gaming/PlayerContainer/Player_1/NameUnit/NameLayout/nameTxt`
  - `Gaming/PlayerContainer/Player_2/NameUnit/NameLayout/nameTxt`
- per-round bid history rows were readable under:
  - `Gaming/PlayerContainer/Player_X/containers/RoundUnit...`
- previous-round bid text was readable from row-local `priceTxt`
- the current user's in-game name during the probe was `melo`
- `GetNodeState` on these paths returned readable `text` values for both player names and round-price rows

Important clarification:

- these paths are runtime Unity UI node paths observed from the current game build
- they are not expected to appear as string literals inside the repository source tree
- implementation must treat them as runtime-observed UI structure, not as codebase-defined constants

This means the new strategy can be implemented entirely inside the native `AutoAuction` flow without adding any new IPC command or renderer-side logic.

## User Decisions Captured

- implement this as a native `AutoAuction` strategy change, not an app-side post-processing rule
- keep the current first-round strategy unchanged
- apply the new limit only for rounds 2 through 5
- identify the opponent using an optional `selfName` command argument, defaulting to `melo`
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

This is a price-cap / do-not-overpay guard, not a general "safe ceiling" inferred from opponent strength. It only constrains bids downward when the opponent's previous-round bid implies a lower acceptable cap than the current original strategy.

### 2. Fallback Rules

The strategy must fall back to `originalBid` when any of the following is true:

- the current round number cannot be parsed as a positive integer
- the current round is not in `2..5`
- neither visible player name can be read
- both visible player names equal `selfName`
- the non-`selfName` player cannot be determined uniquely
- the opponent previous-round row cannot be resolved
- the opponent previous-round price text is empty
- the opponent previous-round price text cannot be parsed into a positive integer
- the computed `opponentCap` is non-positive

This fallback is deliberate. The rule is an opportunistic limiter, not a hard dependency for bidding.

An additional live-timing fallback also applies:

- if our bid window opens before the opponent previous-round `priceTxt` has been populated in the visible UI, the limiter is skipped and the script uses `originalBid`
- this round does not add waiting or polling for late UI population

### 3. Native Implementation Shape

Only `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` changes for the runtime logic.

`AggregateOperationSemantics.h` keeps the existing `ComputeBidAmount()` behavior unchanged. It remains the source of the original expected-price strategy.

`AutoAuction` gains one optional request argument:

```json
{
  "roomId": 101,
  "useExpectedPrice": true,
  "selfName": "melo"
}
```

Rules:

- `selfName` is optional
- when omitted or empty, native defaults it to `melo`
- existing callers remain valid without modification

Inside `MetaOperations.cpp`, add small local helpers for:

- parsing round text like `第4轮` or `4` into an integer round number
- reading player name text for `Player_1` and `Player_2`
- selecting the opponent slot as the player whose name is not `selfName`
- locating the opponent previous-round row by matching `roundTxt`, not by assuming child index
- parsing formatted price text like `17,986`, `17，986`, or `17986` into integer `17986`
- returning the round-specific opponent-cap multiplier for rounds 2 through 5

These helpers stay file-local and are used only by `CmdAutoAuction`.

Threading note:

- all these UI reads happen on the same native agent worker thread that already performs `DetectScreenState`, `ResolveUiNodeMatches`, and `ClickNode`
- this is consistent with current agent behavior, but still depends on the present IL2CPP/Unity runtime tolerating these reads from the attached worker thread
- this spec does not attempt to redesign that threading model

### 3.1 Round Number Parsing Contract

The round parser must not depend on one exact string format.

Accepted inputs:

- `第4轮`
- `4`
- any trimmed string containing exactly one positive decimal digit run that represents the round number

Recommended rule:

- scan the string for the first contiguous ASCII digit run
- parse it as a base-10 positive integer
- if no positive integer can be extracted, parsing fails

Examples:

- `第4轮` -> `4`
- `4` -> `4`
- `Round 5` -> `5`
- `` or `--` -> parse failure

### 3.2 Previous-Round Row Resolution

The implementation must not map round history rows by raw child index alone.

For the selected opponent slot:

1. inspect `Gaming/PlayerContainer/Player_X/containers`
2. enumerate active direct children whose names are `RoundUnit` or start with `RoundUnit(`
3. for each candidate row:
   - read its child `roundTxt`
   - parse that row round number using the same round parser contract
4. choose the row whose parsed round number equals `currentRoundNumber - 1`
5. read that row's sibling `priceTxt`

If no matching row is found, the limiter is skipped.

This avoids depending on whether the UI uses:

- `RoundUnit`, `RoundUnit(Clone)[0]`, ...
- insertion order
- hidden template rows
- non-stable child indexing

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
3. if round is `2..5`, resolve `selfName` and try to identify the opponent slot
4. if opponent slot is known, locate the previous-round row by `roundTxt`
5. if successful, read and parse `opponentPreviousBid`
6. if successful, compute `opponentCap`
7. set `amount = min(originalBid, opponentCap)`
8. otherwise set `amount = originalBid`
9. continue with the existing bid input/confirm flow

No other part of the `AutoAuction` navigation, cleanup, cancelation, or pipe protocol changes.

### 4.1 Runtime Safety Notes

The implementation must preserve current behavior in these edge cases:

- if the opponent row exists but its `priceTxt` is still empty, do not wait; fall back immediately
- if multiple rows claim the same previous round number, treat the result as ambiguous and fall back
- if `selfName` does not match either visible player, the limiter is skipped
- if both visible names equal `selfName`, the limiter is skipped
- if `selfName` matching fails because the user renamed themselves and did not pass the new value, the script still bids using the original strategy

### 5. Logging

Add one high-signal native log line per attempted constrained bid for rounds 2 through 5.

Use the existing thread-safe native logger:

- `Logf(...)`

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

Do not claim coverage for file-local `MetaOperations.cpp` helpers from `AggregateOperationSemantics.test.cpp`.

Default testing plan:

- keep existing original-strategy tests in `AggregateOperationSemantics.test.cpp`
- add a new adjacent native test file, `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`, for the new parser/cap-selection helper logic

If implementation ends up moving pure helper code into a tiny shared header for test visibility, that is acceptable, but the orchestration and UI traversal stay in `MetaOperations.cpp`.

At minimum cover:

- round 2 multiplier = `1.65`
- round 3 multiplier = `1.4`
- round 4 multiplier = `1.23`
- round 5 multiplier = `1.1`
- unsupported rounds return "no cap" behavior
- `17,986` parses to `17986`
- `17，986` parses to `17986`
- `17986` parses to `17986`
- empty or malformed price text fails parsing
- `第4轮` parses to `4`
- `4` parses to `4`
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
- when `selfName` is omitted, default matching to `melo` still works
- when `selfName` is passed explicitly, opponent detection uses it
- when opponent data is unavailable, the script still bids using the original strategy
- the new rule does not break `AutoAuction` cancelation or cleanup behavior

## Non-Goals

- no change to the round-1 strategy
- no change to rounds 6+
- no new app-side controls or Elsa UI changes
- no new preload API or pipe command
- no protocol response shape change for `AutoAuction`

## Files Expected To Change

- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

`AggregateOperationSemantics.h` may stay unchanged unless a tiny helper is clearly better placed there, but the default plan is to keep the new strategy-specific logic inside `MetaOperations.cpp`.
