# Auto Auction Ended Cleanup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AutoAuction` reliably detect the winner on the auction-ended screen, wait for quick-recycle when `melo` won, and keep clicking continue until the flow fully exits to lobby and then main lobby.

**Architecture:** Keep the runtime cleanup flow inside `CmdAutoAuction`, but move the winner/cleanup decisions into small pure helpers so native tests can lock the behavior. The cleanup phase should read `EndPanel/Player/NameUnit/Root/TxtName`, treat `melo` as self-win, poll for `PanelBattleHuiShouTran/huishou` only in that branch, and keep re-checking `DetectScreenState()` after each continue click.

**Tech Stack:** C++11, BKAutoOpAgent native tests (`MetaOperations.test.cpp`), WSL MinGW build script

---

### Task 1: Add test-covered ended-screen decision helpers

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AutoAuctionOpponentCap.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`

- [ ] **Step 1: Write the failing tests**

```cpp
assert(IsAutoAuctionWinnerSelf("melo", "melo"));
assert(!IsAutoAuctionWinnerSelf("melo", "对手"));
assert(!IsAutoAuctionWinnerSelf("melo", ""));

assert(ShouldWaitForQuickRecycle("melo", "melo"));
assert(!ShouldWaitForQuickRecycle("melo", "对手"));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"`
Expected: FAIL because the helper functions do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```cpp
inline bool IsAutoAuctionWinnerSelf(const std::string& selfName, const std::string& winnerName) {
    return !selfName.empty() && !winnerName.empty() && selfName == winnerName;
}

inline bool ShouldWaitForQuickRecycle(const std::string& selfName, const std::string& winnerName) {
    return IsAutoAuctionWinnerSelf(selfName, winnerName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"`
Expected: PASS

### Task 2: Apply the cleanup flow to AutoAuction

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`

- [ ] **Step 1: Implement winner-name read and quick-recycle wait loop**

```cpp
std::string winnerName;
TryReadAutoAuctionEndedWinnerName(se.battleMainTransform, &winnerName);
const bool shouldWaitForRecycle = ShouldWaitForQuickRecycle(selfName, winnerName);
```

- [ ] **Step 2: Gate quick-recycle polling on self-win**

```cpp
if (shouldWaitForRecycle) {
    // poll EndPanel winner text + huishou button for a bounded window
}
```

- [ ] **Step 3: Keep clicking continue while the screen is still `auction_ended`**

```cpp
if (IsAutoAuctionCleanupEndedScreen(se.screen)) {
    ClickNode(se.battleMainTransform, "EndPanel/tuichu/continueBtn", 0, &e);
    SleepInterruptibly(1500);
    continue;
}
```

- [ ] **Step 4: Run verification**

Run:
- `wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"`
- `wsl bash -lc "cd /mnt/a/BidKing && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"`

Expected:
- Native helper test passes
- `BKAutoOpAgent.dll` rebuilds successfully
