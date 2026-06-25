# Auto Auction Abandoned Warehouse First-Round Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AutoAuction` use a `30000` first-round minimum bid floor for room `102` (`废弃仓库`) while keeping every other room at the existing `17000` floor.

**Architecture:** Keep the room-specific rule inside the existing native auto-auction semantics layer. Add one tiny helper in `AggregateOperationSemantics.h` to resolve the first-round floor from `roomId`, then have `MetaOperations.cpp` pass that resolved floor into the unchanged `ClampAutoAuctionFirstRoundBid(...)` behavior.

**Tech Stack:** C++11 native agent code, WSL `g++` semantics test compilation, MinGW `x86_64-w64-mingw32-g++` build script, markdown current-state docs

---

## File Map

- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
  - Responsibility: define the room-specific first-round floor helper and keep the existing first-round clamp logic unchanged
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
  - Responsibility: lock the `102 -> 30000` rule, keep non-`102` rooms at `17000`, and prove later rounds still do not clamp
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
  - Responsibility: resolve the room-specific first-round floor before calling `ClampAutoAuctionFirstRoundBid(...)`
- Modify: `docs/Documentation.md`
  - Responsibility: record the current AutoAuction room-`102` first-round floor rule

### Task 1: Add Red Tests And Minimal Native Room-Specific Floor Logic

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

- [ ] **Step 1: Write the failing semantics test coverage**

In `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`, replace the current first-round floor block around the existing `17000` assertions with this expanded coverage:

```cpp
    assert(ResolveAutoAuctionFirstRoundFloorAmount(102) == 30000);
    assert(ResolveAutoAuctionFirstRoundFloorAmount(101) == 17000);
    assert(ResolveAutoAuctionFirstRoundFloorAmount(103) == 17000);

    // First round floor: room 102 uses 30000, all other rooms keep 17000.
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 30000);
    assert(ClampAutoAuctionFirstRoundBid(
        29999,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 30000);
    assert(ClampAutoAuctionFirstRoundBid(
        30000,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 30000);
    assert(ClampAutoAuctionFirstRoundBid(
        35000,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 35000);

    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(101)
    ) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(
        15000,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(103)
    ) == 17000);

    // Not first round: no room-specific clamping.
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        2,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 11119);
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        3,
        ResolveAutoAuctionFirstRoundFloorAmount(101)
    ) == 11119);
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        0,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 11119);
```

- [ ] **Step 2: Run the semantics test to verify it fails first**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"
```

Expected: failure because `ResolveAutoAuctionFirstRoundFloorAmount(...)` does not exist yet.

- [ ] **Step 3: Write the minimal semantics helper and wire the bid loop to it**

In `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`, add the new helper immediately above `ClampAutoAuctionFirstRoundBid(...)`:

```cpp
inline int ResolveAutoAuctionFirstRoundFloorAmount(int roomId) {
    return roomId == 102 ? 30000 : 17000;
}

// Hard floor for the first observed round — ensures the opening bid is competitive.
// roundsEncountered is the script-observed counter (not the game's round number).
inline int ClampAutoAuctionFirstRoundBid(
    int amount,
    int roundsEncountered,
    int floorAmount
) {
    if (roundsEncountered == 1 && amount < floorAmount) {
        return floorAmount;
    }
    return amount;
}
```

Then update the `AutoAuction` bid loop in `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` from:

```cpp
        amount = ClampAutoAuctionFirstRoundBid(amount, roundsEncountered, 17000);
```

to:

```cpp
        const int firstRoundFloorAmount = ResolveAutoAuctionFirstRoundFloorAmount(roomId);
        amount = ClampAutoAuctionFirstRoundBid(amount, roundsEncountered, firstRoundFloorAmount);
```

- [ ] **Step 4: Run the semantics test again to verify it passes**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"
```

Expected: command exits successfully with no assertion failure.

- [ ] **Step 5: Rebuild the native agent to verify `MetaOperations.cpp` still compiles**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"
```

Expected: output includes `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`.

- [ ] **Step 6: Restore the generated DLL so the commit only contains source changes**

Run:

```bash
git checkout -- tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
```

Expected: `git status --short` no longer shows the rebuilt DLL as modified.

- [ ] **Step 7: Commit the green native code and tests**

Run:

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "feat: add abandoned warehouse first-round floor"
```

### Task 2: Record Current-State Docs And Re-Verify

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: Update the Inject / AutoOperation current-state documentation**

Add this bullet in `docs/Documentation.md` immediately after the existing `src/inject/panels/InjectMetaOperationPanel.vue` bullet in the Inject section:

```markdown
- 当前 `AutoAuction` 第一回合最低价仍默认按 `17000` 起拍，但当 `roomId = 102`（`废弃仓库`）时，native agent 会改用 `30000` 作为首回合 floor；该规则由 `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` 统一解析，并由 `MetaOperations.cpp` 在出价循环里消费。
```

- [ ] **Step 2: Run the targeted verification and diff sanity check**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"
git checkout -- tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git diff --check
```

Expected:

- the semantics test command exits successfully
- the build script prints `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`
- `git diff --check` prints no output

- [ ] **Step 3: Commit the documentation update**

Run:

```bash
git add docs/Documentation.md
git commit -m "docs: record abandoned warehouse first-round floor"
```

## Spec Coverage Check

- Goal covered by Task 1 helper + runtime call site and room-`102` red/green tests.
- Non-goals preserved because the plan keeps every non-`102` room at `17000`, leaves later rounds unchanged, and does not touch UI wording or expected-price behavior.
- Current-state documentation is covered by Task 2.

## Final Verification Reminder

Before claiming completion during execution, keep fresh evidence for:

- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"`
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-abandoned-warehouse-minimum && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"`
- `git diff --check`

If execution touches additional native test files beyond this plan, expand verification to the smallest matching scope before closing the task.
