# Expected-Price Confirm Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polling "confirm gate" to the `useExpectedPrice` bid path inside `CmdAutoAuction` that delays the final `InputDevice/Panel1/chujia` click until (a) the opponent has placed a bid in the current round, or (b) the round clock is at ≤ 2 seconds.

**Architecture:** Three files change. `AggregateOperationSemantics.h` gains two enums and a pure path-builder. `MetaOperations.cpp` gains two new static helpers and a small diff inside `CmdAutoAuction`. The `legacy bidAmount` path is untouched.

**Tech Stack:** C++11, Win32 API (DWORD, GetTickCount, Sleep), cross-compiled with `x86_64-w64-mingw32-g++`. Unit tests compile with Linux `g++` inside WSL.

## Global Constraints

- All `g++` / `build.sh` invocations must run inside WSL — not native Windows PowerShell.
- Do NOT add parameters to `CmdAutoAuction`'s public JSON API or its return structure.
- `legacy bidAmount` path (`useExpectedPrice == false`) must remain byte-for-byte unchanged.
- No new Electron bridge, renderer, or cross-process code.
- Every new hard exit (authcode, interrupted, auction_ended) must propagate via its own field in `ConfirmGateWaitResult`, never folded into `CONFIRM_GATE_NOT_READY`.

---

### Task 1: Add gate enums + path helper to AggregateOperationSemantics.h, then add tests

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

**Interfaces:**
- Produces: `ConfirmGateResult` enum, `ConfirmGateSoftExitReason` enum, `GetOpponentCurrentRoundBidPath(int slot, int round) → std::string`, `GetExpectedPriceConfirmGatePollIntervalMs() → int`

---

- [ ] **Step 1: Write failing test block**

Append the following block at the end of `AggregateOperationSemantics.test.cpp`, just before the final `return 0;`:

```cpp
    // ---- Expected-price confirm gate ----------------------------------------

    // Current-round bid path: round 1 uses RoundUnit, round N uses RoundUnit(Clone)[N-2]
    assert(GetOpponentCurrentRoundBidPath(1, 1) ==
        "Gaming/PlayerContainer/Player_1/containers/RoundUnit/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(2, 1) ==
        "Gaming/PlayerContainer/Player_2/containers/RoundUnit/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(1, 2) ==
        "Gaming/PlayerContainer/Player_1/containers/RoundUnit(Clone)[0]/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(2, 3) ==
        "Gaming/PlayerContainer/Player_2/containers/RoundUnit(Clone)[1]/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(1, 5) ==
        "Gaming/PlayerContainer/Player_1/containers/RoundUnit(Clone)[3]/priceTxt");

    // Three-state result: all distinct
    assert(CONFIRM_GATE_READY_OPPONENT_BID  != CONFIRM_GATE_READY_TIME_FALLBACK);
    assert(CONFIRM_GATE_READY_OPPONENT_BID  != CONFIRM_GATE_NOT_READY);
    assert(CONFIRM_GATE_READY_TIME_FALLBACK != CONFIRM_GATE_NOT_READY);

    // Soft-exit reasons: all distinct
    assert(CONFIRM_GATE_SOFT_EXIT_NONE          != CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED);
    assert(CONFIRM_GATE_SOFT_EXIT_NONE          != CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST);
    assert(CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED != CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST);

    // CONFIRM_GATE_NOT_READY is not a ready state (soft exit ≠ success)
    assert(CONFIRM_GATE_NOT_READY != CONFIRM_GATE_READY_OPPONENT_BID);
    assert(CONFIRM_GATE_NOT_READY != CONFIRM_GATE_READY_TIME_FALLBACK);

    // Poll interval
    assert(GetExpectedPriceConfirmGatePollIntervalMs() == 100);
```

- [ ] **Step 2: Run test to verify it fails (symbol not defined)**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
g++ -o test_agg AggregateOperationSemantics.test.cpp -std=c++11 2>&1 | head -20
```

Expected: compile error — `GetOpponentCurrentRoundBidPath` / enum names not declared.

- [ ] **Step 3: Add the enums and helpers to AggregateOperationSemantics.h**

Add `#include <stdio.h>` to the existing include block at the top of the file (after the existing includes). Then append the following section at the very end of the file, after the exchange semantics block:

```cpp
// ---- Expected-price confirm gate semantics ---------------------------------

enum ConfirmGateResult {
    CONFIRM_GATE_READY_OPPONENT_BID  = 0,
    CONFIRM_GATE_READY_TIME_FALLBACK = 1,
    CONFIRM_GATE_NOT_READY           = 2
};

enum ConfirmGateSoftExitReason {
    CONFIRM_GATE_SOFT_EXIT_NONE          = 0,
    CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED = 1,
    CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST   = 2
};

// Returns the UI path to the current-round price cell for the given player slot
// and script-side round counter (1-based, matches roundsEncountered in CmdAutoAuction).
// round == 1  → RoundUnit/priceTxt
// round >= 2  → RoundUnit(Clone)[round-2]/priceTxt
inline std::string GetOpponentCurrentRoundBidPath(int slot, int round) {
    char path[256];
    if (round <= 1) {
        snprintf(path, sizeof(path),
            "Gaming/PlayerContainer/Player_%d/containers/RoundUnit/priceTxt",
            slot);
    } else {
        snprintf(path, sizeof(path),
            "Gaming/PlayerContainer/Player_%d/containers/RoundUnit(Clone)[%d]/priceTxt",
            slot, round - 2);
    }
    return std::string(path);
}

inline int GetExpectedPriceConfirmGatePollIntervalMs() { return 100; }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
g++ -o test_agg AggregateOperationSemantics.test.cpp -std=c++11 && ./test_agg && echo "PASS"
```

Expected: `PASS` with no output before it.

- [ ] **Step 5: Commit**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "feat: add confirm-gate enums and current-round bid path helper"
```

---

### Task 2: Add TryReadOpponentCurrentRoundBid and WaitForExpectedPriceConfirmGate to MetaOperations.cpp

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

**Interfaces:**
- Consumes: `GetOpponentCurrentRoundBidPath`, `ConfirmGateResult`, `ConfirmGateSoftExitReason` (from Task 1); existing static helpers `ReadExactNodeText`, `TryParsePriceText`, `ReadBidState`, `HasActiveBidInputDialog`, `DetectScreenState`, `IsAutoAuctionVerificationScreen`, `IsAutoAuctionStopRequested`, `SleepInterruptibly` (all already in file).
- Produces: `struct ConfirmGateWaitResult`, `static bool TryReadOpponentCurrentRoundBid(...)`, `static ConfirmGateWaitResult WaitForExpectedPriceConfirmGate(...)`

---

- [ ] **Step 1: Add ConfirmGateWaitResult struct and TryReadOpponentCurrentRoundBid**

Locate `TryReadOpponentPreviousRoundBid` in `MetaOperations.cpp` (around line 1719). Insert the following block immediately **after** the closing `}` of `TryReadOpponentPreviousRoundBid` (after line ~1785), before the `// AutoAuction: full automated auction sequence` comment:

```cpp
static bool TryReadOpponentCurrentRoundBid(
    Il2CppObject* battleTransform,
    int opponentSlot,
    int roundNumber,
    int* outBid
) {
    if (outBid) *outBid = 0;
    if (!battleTransform || opponentSlot <= 0 || roundNumber <= 0 || !outBid) return false;
    const std::string path = GetOpponentCurrentRoundBidPath(opponentSlot, roundNumber);
    std::string priceText;
    if (!ReadExactNodeText(battleTransform, path.c_str(), &priceText) || priceText.empty()) return false;
    return TryParsePriceText(priceText, outBid) && *outBid > 0;
}

struct ConfirmGateWaitResult {
    ConfirmGateResult         result           = CONFIRM_GATE_NOT_READY;
    ConfirmGateSoftExitReason softExitReason   = CONFIRM_GATE_SOFT_EXIT_NONE;
    int                       opponentRoundBid = 0;
    bool hardExitAuthcode    = false;
    bool hardExitInterrupted = false;
    bool hardExitAuctionEnded = false;
};
```

- [ ] **Step 2: Add WaitForExpectedPriceConfirmGate**

Immediately after the `ConfirmGateWaitResult` struct (still before the `// AutoAuction:` comment), add:

```cpp
// Polls every 100ms inside the bid dialog (after amount is written, before confirm click).
// Returns a ready result when the gate fires, or a hard/soft exit reason when it can't.
// Hard exits (authcode, interrupted, auction_ended) each have their own bool field so
// the caller never mistakes them for the soft-exit NOT_READY path.
static ConfirmGateWaitResult WaitForExpectedPriceConfirmGate(
    Il2CppObject*      battleTransform,
    int                opponentSlot,
    const std::string& gateEntryRoundText,
    int                gateEntryRoundNumber,
    int                amountForLog,
    const std::string& opponentNameForLog
) {
    static const int kPollMs = GetExpectedPriceConfirmGatePollIntervalMs();
    ConfirmGateWaitResult ret;

    {
        std::string roundText;
        int secsAtEntry = 9999;
        ReadBidState(battleTransform, &roundText, &secsAtEntry);
        Logf(
            "AutoAuction expected-price confirm gate: entering round=%d secs=%d amount=%d opponent=%s",
            gateEntryRoundNumber,
            secsAtEntry,
            amountForLog,
            opponentNameForLog.empty() ? "(unresolved)" : opponentNameForLog.c_str()
        );
    }

    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            ret.hardExitInterrupted = true;
            return ret;
        }

        ScreenState sc = DetectScreenState();

        if (IsAutoAuctionVerificationScreen(sc.screen)) {
            ret.hardExitAuthcode = true;
            return ret;
        }

        if (strcmp(sc.screen, "auction_ended") == 0) {
            ret.hardExitAuctionEnded = true;
            return ret;
        }

        if (strcmp(sc.screen, "auction_in_progress") != 0 || !sc.battleMainTransform) {
            ret.softExitReason = CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST;
            Logf(
                "AutoAuction expected-price confirm gate: interrupted reason=dialog_lost screen=%s",
                sc.screen ? sc.screen : "null"
            );
            return ret;
        }

        std::string currentRound;
        int currentSecs = 9999;
        ReadBidState(sc.battleMainTransform, &currentRound, &currentSecs);

        if (!currentRound.empty() && currentRound != gateEntryRoundText) {
            ret.softExitReason = CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED;
            Logf("AutoAuction expected-price confirm gate: interrupted reason=round_changed");
            return ret;
        }

        if (!HasActiveBidInputDialog(sc.battleMainTransform)) {
            ret.softExitReason = CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST;
            Logf("AutoAuction expected-price confirm gate: interrupted reason=dialog_lost (dialog gone)");
            return ret;
        }

        if (currentSecs <= 2) {
            ret.result = CONFIRM_GATE_READY_TIME_FALLBACK;
            Logf(
                "AutoAuction expected-price confirm gate: ready reason=time_fallback secs=%d",
                currentSecs
            );
            return ret;
        }

        if (opponentSlot > 0) {
            int opponentBid = 0;
            if (TryReadOpponentCurrentRoundBid(
                    sc.battleMainTransform, opponentSlot, gateEntryRoundNumber, &opponentBid)) {
                ret.result = CONFIRM_GATE_READY_OPPONENT_BID;
                ret.opponentRoundBid = opponentBid;
                Logf(
                    "AutoAuction expected-price confirm gate: ready reason=opponent_bid opponentRoundBid=%d",
                    opponentBid
                );
                return ret;
            }
        }

        if (!SleepInterruptibly(kPollMs)) {
            ret.hardExitInterrupted = true;
            return ret;
        }
    }
}
```

- [ ] **Step 3: Verify the file compiles (DLL build)**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
bash build.sh 2>&1
```

Expected: `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "feat: add TryReadOpponentCurrentRoundBid and WaitForExpectedPriceConfirmGate helpers"
```

---

### Task 3: Wire up the gate inside CmdAutoAuction

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

**Interfaces:**
- Consumes: `ConfirmGateWaitResult`, `WaitForExpectedPriceConfirmGate` (Task 2); `capOpponentSlot`, `capOpponentName` (declared in this task); existing `round`, `roundsEncountered`, `finalAmount`, `s2.battleMainTransform`, `sendAuthCodeRequired`, `stopIfRequested` (all already in `CmdAutoAuction` scope).

Two edits are required inside `CmdAutoAuction`, both within the `// Step 6: bid loop` section.

---

- [ ] **Step 1: Hoist capOpponentSlot and capOpponentName before the cap block**

Locate the cap block that begins with:
```cpp
        if (useExpectedPrice && roundsEncountered >= 2 && roundsEncountered <= 5) {
                std::string fallbackReason;
                std::string opponentName;
```

**Before** that `if (useExpectedPrice ...` line, insert:
```cpp
        int capOpponentSlot = 0;
        std::string capOpponentName;
```

Then inside the cap block, make the following substitutions (the variable names `opponentSlot` and `opponentName` existed only inside this block; replace them with the hoisted variables):

Replace this declaration (inside the `else` branch, after `TryResolveOpponentSlot`):
```cpp
                    int opponentSlot = 0;
                    if (!TryResolveOpponentSlot(
```
With (remove the `int opponentSlot = 0;` line entirely; use `capOpponentSlot` in the `TryResolveOpponentSlot` call):
```cpp
                    if (!TryResolveOpponentSlot(
```
And change the `&opponentSlot` argument to `&capOpponentSlot`.

Replace:
```cpp
                        opponentName = opponentSlot == 1 ? player1Name : player2Name;
```
With:
```cpp
                        capOpponentName = capOpponentSlot == 1 ? player1Name : player2Name;
```

Replace the `Logf` that already logs `opponentName.c_str()` inside the successful cap computation block:
```cpp
                                        "AutoAuction round=%d opponent=%s prevBid=%d multiplier=%.2f originalBid=%d cappedBid=%d finalBid=%d",
                                        roundsEncountered,
                                        opponentName.c_str(),
```
With:
```cpp
                                        "AutoAuction round=%d opponent=%s prevBid=%d multiplier=%.2f originalBid=%d cappedBid=%d finalBid=%d",
                                        roundsEncountered,
                                        capOpponentName.c_str(),
```

Replace the two log calls in the `if (!fallbackReason.empty())` section:
```cpp
                if (!fallbackReason.empty()) {
                    if (!opponentName.empty()) {
                        Logf(
                            "AutoAuction round=%d limiter skipped: %s; originalBid=%d; opponent=%s",
                            roundsEncountered,
                            fallbackReason.c_str(),
                            originalBid,
                            opponentName.c_str()
                        );
                    } else {
```
With:
```cpp
                if (!fallbackReason.empty()) {
                    if (!capOpponentName.empty()) {
                        Logf(
                            "AutoAuction round=%d limiter skipped: %s; originalBid=%d; opponent=%s",
                            roundsEncountered,
                            fallbackReason.c_str(),
                            originalBid,
                            capOpponentName.c_str()
                        );
                    } else {
```

Also remove the `std::string opponentName;` declaration that was at the top of the cap block (right after `std::string fallbackReason;`).

- [ ] **Step 2: Insert the gate call after the input-settle poll, before the primary confirm click**

Locate this section inside the `if (setBidAmountSucceeded)` block — the settle poll followed immediately by the confirm click:

```cpp
                        // Short settle poll after input (replaces SleepInterruptibly(500))
                        {
                            DWORD inputSettleStart = GetTickCount();
                            for (;;) {
                                if (!SleepInterruptibly(50)) { stopIfRequested(); return; }
                                DWORD inputElapsed = GetTickCount() - inputSettleStart;
                                if ((int)inputElapsed >= 600) break;
                                ScreenState settleSc = DetectScreenState();
                                if (IsAutoAuctionVerificationScreen(settleSc.screen)) {
                                    Logf("AutoAuction interrupted: AuthCode_Main detected during input settle");
                                    sendAuthCodeRequired();
                                    return;
                                }
                            }
                        }
                        bool primaryConfirmClicked = ClickNode(
```

Insert the gate block **between** the closing `}` of the settle-poll block and the `bool primaryConfirmClicked = ClickNode(` line:

```cpp
                        // Expected-price confirm gate: wait until opponent bids or secs <= 2
                        if (useExpectedPrice) {
                            ConfirmGateWaitResult gateResult = WaitForExpectedPriceConfirmGate(
                                s2.battleMainTransform,
                                capOpponentSlot,
                                round,
                                roundsEncountered,
                                finalAmount,
                                capOpponentName
                            );
                            if (gateResult.hardExitAuthcode) {
                                Logf("AutoAuction interrupted: AuthCode_Main detected during expected-price confirm gate");
                                sendAuthCodeRequired();
                                return;
                            }
                            if (gateResult.hardExitInterrupted) {
                                stopIfRequested();
                                return;
                            }
                            if (gateResult.hardExitAuctionEnded ||
                                gateResult.result == CONFIRM_GATE_NOT_READY) {
                                continue;
                            }
                        }
```

- [ ] **Step 3: Build to verify the diff compiles**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
bash build.sh 2>&1
```

Expected: `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll` with no errors.

- [ ] **Step 4: Run semantics tests to confirm no regressions**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
g++ -o test_agg AggregateOperationSemantics.test.cpp -std=c++11 && ./test_agg && echo "PASS agg"
g++ -o test_meta MetaOperations.test.cpp -std=c++11 && ./test_meta && echo "PASS meta"
```

Expected: both print `PASS`.

- [ ] **Step 5: Commit**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "feat: wire expected-price confirm gate into CmdAutoAuction bid loop"
```

---

### Task 4: Final build, test suite, and manual verification checklist

**Files:** (read-only verification, no edits)

- [ ] **Step 1: Clean build from scratch**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
rm -f BKAutoOpAgent.dll test_agg test_meta
bash build.sh 2>&1
```

Expected: `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`

- [ ] **Step 2: Run full test suite**

```bash
cd /mnt/a/BidKing-worktrees/expected-price-confirm-gate/tools/inject/AutoOperation/BKAutoOpAgent
g++ -o test_agg AggregateOperationSemantics.test.cpp -std=c++11 && ./test_agg && echo "PASS agg"
g++ -o test_meta MetaOperations.test.cpp -std=c++11 && ./test_meta && echo "PASS meta"
```

Expected: `PASS agg` and `PASS meta`.

- [ ] **Step 3: Manual verification checklist**

Deploy the updated `BKAutoOpAgent.dll` and run AutoAuction with `useExpectedPrice=true`. Verify each scenario:

1. **Opponent bids first** — confirm fires immediately after reading a valid price in opponent's current-round cell; log shows `reason=opponent_bid opponentRoundBid=<n>`.
2. **Opponent never bids** — confirm fires at `secs <= 2`; log shows `reason=time_fallback`.
3. **Round 1 or unresolved opponent** — `capOpponentSlot = 0`; gate degrades to time-only (`reason=time_fallback`); no hard failure.
4. **Round advances mid-wait** — log shows `interrupted reason=round_changed`; next outer-loop iteration re-opens dialog for the new round.
5. **Bid dialog opens early, amount set early** — `Gaming/chujia` click and input happen at the same rhythm as before; the gate is the only new delay.
6. **Legacy mode** (`useExpectedPrice=false`) — gate block is never entered; `secs < 15` behavior unchanged.
7. **Authcode during gate wait** — log shows `AutoAuction interrupted: AuthCode_Main detected during expected-price confirm gate`; result is `authcode_required`.
8. **Auction ends during gate wait** — gate returns `hardExitAuctionEnded=true`; bid loop breaks naturally on next poll; cleanup proceeds normally.

- [ ] **Step 4: Commit verification notes (optional)**

If any manual-verification finding requires a code fix, fix it and re-run Steps 1–3 before committing.
