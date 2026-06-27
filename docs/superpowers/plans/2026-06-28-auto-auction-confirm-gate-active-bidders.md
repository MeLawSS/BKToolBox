# Auto Auction Confirm Gate Active Bidders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make expected-price auto-auction confirm gating use the previous round's positive bidders count from round 2 onward, so player dropouts do not block confirm unnecessarily.

**Architecture:** Keep the behavioral rule in `AggregateOperationSemantics.h` as a pure helper, then feed it with a previous-round positive bidder count collected inside `MetaOperations.cpp`. Preserve first-round behavior and use explicit fallback to the current visible-player rule when history is unavailable.

**Tech Stack:** C++, inline semantics helpers, existing `test_agg` / `test_meta` native test binaries

---

### Task 1: Lock the confirm-gate rule with a failing semantics test

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/test_agg`

- [ ] **Step 1: Write the failing test**

```cpp
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(4, 1, 0) == 3);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(4, 2, 3) == 2);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(4, 3, 2) == 1);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(4, 2, 0) == 3);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_confirm_gate_agg_test"`
Expected: FAIL with helper-arity compile errors because the implementation still only accepts visible-player count

### Task 2: Implement the semantics helper

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/test_agg`

- [ ] **Step 1: Write minimal implementation**

```cpp
inline int GetExpectedPriceConfirmGateRequiredOtherBidCount(
    int visibleNamedPlayerCount,
    int currentRoundNumber,
    int previousRoundPositiveBidderCount
) {
    const int visibleRule = visibleNamedPlayerCount <= 1 ? 0 : visibleNamedPlayerCount - 1;
    if (currentRoundNumber <= 1) {
        return visibleRule;
    }
    if (previousRoundPositiveBidderCount >= 1) {
        const int historicalRule = previousRoundPositiveBidderCount - 1;
        return historicalRule > 0 ? historicalRule : 0;
    }
    return visibleRule;
}
```

- [ ] **Step 2: Update the related gate helpers to pass through the new parameters**

```cpp
inline bool IsExpectedPriceConfirmGateVisiblePlayersReady(
    int visibleNamedPlayerCount,
    int currentRoundNumber,
    int previousRoundPositiveBidderCount,
    int activeBidSignalCount
)
```

```cpp
inline bool IsExpectedPriceConfirmGateOpponentBidSignalReady(
    int visibleNamedPlayerCount,
    int currentRoundNumber,
    int previousRoundPositiveBidderCount,
    int activeBidSignalCount
)
```

```cpp
inline bool ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(
    int visibleNamedPlayerCount,
    int currentRoundNumber,
    int previousRoundPositiveBidderCount,
    int entryBidSignalCount
)
```

- [ ] **Step 3: Run test to verify it passes**

Run: `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_confirm_gate_agg_test && /tmp/bk_autoauction_confirm_gate_agg_test"`
Expected: PASS

### Task 3: Feed previous-round positive bidder counts into the confirm gate

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Test: `tools/inject/AutoOperation\BKAutoOpAgent\test_meta`

- [ ] **Step 1: Count previous-round positive bidders across visible slots**

```cpp
static int CountPreviousRoundPositiveBidders(
    Il2CppObject* battleTransform,
    int currentRoundNumber
) {
    if (!battleTransform || currentRoundNumber <= 1) return 0;
    const int slotCount = GetAutoAuctionExpectedPriceConfirmGateMaxPlayerSlots();
    int count = 0;
    for (int slot = 1; slot <= slotCount; ++slot) {
        int bid = 0;
        std::string reason;
        if (TryReadOpponentPreviousRoundBid(battleTransform, slot, currentRoundNumber, &bid, &reason) && bid > 0) {
            count++;
        }
    }
    return count;
}
```

- [ ] **Step 2: Pass the historical count into the confirm-gate readiness checks**

```cpp
const int previousRoundPositiveBidderCount =
    CountPreviousRoundPositiveBidders(battleMainTransform, roundNumber);
```

```cpp
IsExpectedPriceConfirmGateOpponentBidSignalReady(
    visibleNamedPlayerCount,
    roundNumber,
    previousRoundPositiveBidderCount,
    activeBidSignalCount
)
```

- [ ] **Step 3: Run targeted verification**

Run: `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/bk_autoauction_confirm_gate_meta_test && /tmp/bk_autoauction_confirm_gate_meta_test"`
Expected: PASS

### Task 4: Record the outcome

**Files:**
- Modify: `Documentation.md`

- [ ] **Step 1: Append the decision and verification commands**

```md
## 2026-06-28 AutoAuction confirm gate

- From round 2 onward, expected-price confirm gating now waits for `previousRoundPositiveBidderCount - 1`
- Round 1 still uses `visibleNamedPlayerCount - 1`
- Fallback remains the visible-player rule when previous-round history is unavailable

### Verification

- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_confirm_gate_agg_test && /tmp/bk_autoauction_confirm_gate_agg_test"`
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/bk_autoauction_confirm_gate_meta_test && /tmp/bk_autoauction_confirm_gate_meta_test"`
```

- [ ] **Step 2: Run a final diff/status check**

Run: `git status --short`
Expected: only the intended docs and auto-auction files are modified
