# AutoAuction End-Screen Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native `AutoAuction` click the ended-screen background to skip loot reveal whenever the current ended-screen cleanup stage has no ready action yet, without extending the existing Step 7 / Step 8 wall-clock budgets.

**Architecture:** Keep pure timing and stage-decision rules in `AggregateOperationSemantics.h` so `AggregateOperationSemantics.test.cpp` can lock them first. Keep the actual background-click settle loop inside `MetaOperations.cpp`, then thread it into both the winner / quick-recycle prelude and the ended-screen primary-action cleanup branch using explicit deadlines rather than implicit attempt-count timing.

**Tech Stack:** C++11, inline semantics helpers, BKAutoOpAgent native tests (`AggregateOperationSemantics.test.cpp`), native DLL rebuild via WSL `build.sh`, repo-wide `npm test`

---

### Task 1: Lock ended-screen skip timing and trigger rules with failing semantics tests

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
    assert(GetAutoAuctionEndedWinnerRevealSkipBudgetMs() == 30000);
    assert(GetAutoAuctionEndedCleanupRevealSkipBudgetMs() == 40000);
    assert(GetAutoAuctionEndedRevealSkipSettleWindowMs() == 300);
    assert(GetAutoAuctionEndedRevealSkipPollSliceMs() == 50);

    assert(ClampAutoAuctionEndedRevealSkipWindowMs(1000) == 300);
    assert(ClampAutoAuctionEndedRevealSkipWindowMs(300) == 300);
    assert(ClampAutoAuctionEndedRevealSkipWindowMs(250) == 250);
    assert(ClampAutoAuctionEndedRevealSkipWindowMs(1) == 1);
    assert(ClampAutoAuctionEndedRevealSkipWindowMs(0) == 0);
    assert(ClampAutoAuctionEndedRevealSkipWindowMs(-10) == 0);

    assert(ShouldAttemptAutoAuctionEndedRevealSkipInWinnerStage(false, false, false));
    assert(!ShouldAttemptAutoAuctionEndedRevealSkipInWinnerStage(true, false, false));
    assert(ShouldAttemptAutoAuctionEndedRevealSkipInWinnerStage(true, true, false));
    assert(!ShouldAttemptAutoAuctionEndedRevealSkipInWinnerStage(true, true, true));

    assert(ShouldAttemptAutoAuctionEndedRevealSkipInCleanupStage(nullptr));
    assert(!ShouldAttemptAutoAuctionEndedRevealSkipInCleanupStage("EndPanel/tuichu/receiveBtn"));
    assert(!ShouldAttemptAutoAuctionEndedRevealSkipInCleanupStage("EndPanel/tuichu/continueBtn"));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_end_skip_agg_test && /tmp/bk_autoauction_end_skip_agg_test"`
Expected: FAIL with missing-helper compile errors because the ended-screen skip timing and decision helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```cpp
inline int GetAutoAuctionEndedWinnerRevealSkipBudgetMs() {
    return 30000;
}

inline int GetAutoAuctionEndedCleanupRevealSkipBudgetMs() {
    return GetAutoAuctionCleanupMaxAttempts() * 200;
}

inline int GetAutoAuctionEndedRevealSkipSettleWindowMs() {
    return 300;
}

inline int GetAutoAuctionEndedRevealSkipPollSliceMs() {
    return 50;
}

inline int ClampAutoAuctionEndedRevealSkipWindowMs(int remainingBudgetMs) {
    if (remainingBudgetMs <= 0) return 0;
    const int settleWindowMs = GetAutoAuctionEndedRevealSkipSettleWindowMs();
    return remainingBudgetMs < settleWindowMs ? remainingBudgetMs : settleWindowMs;
}

inline bool ShouldAttemptAutoAuctionEndedRevealSkipInWinnerStage(
    bool winnerResolved,
    bool shouldWaitForQuickRecycle,
    bool quickRecycleReady
) {
    if (!winnerResolved) return true;
    if (!shouldWaitForQuickRecycle) return false;
    return !quickRecycleReady;
}

inline bool ShouldAttemptAutoAuctionEndedRevealSkipInCleanupStage(const char* endedActionPath) {
    return endedActionPath == nullptr;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_end_skip_agg_test && /tmp/bk_autoauction_end_skip_agg_test"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "feat: add autoauction ended reveal skip semantics"
```

### Task 2: Thread ended-screen background skipping into Step 7 and Step 8

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Verify: `tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

- [ ] **Step 1: Add the ended-screen settle helper near the existing poll helpers**

```cpp
enum EndedRevealSkipStatus {
    ENDED_REVEAL_SKIP_RECHECK = 0,
    ENDED_REVEAL_SKIP_READY = 1,
    ENDED_REVEAL_SKIP_SCREEN_CHANGED = 2,
    ENDED_REVEAL_SKIP_AUTHCODE = 3,
    ENDED_REVEAL_SKIP_INTERRUPTED = 4,
    ENDED_REVEAL_SKIP_TIMEOUT = 5
};

struct EndedRevealSkipResult {
    EndedRevealSkipStatus status = ENDED_REVEAL_SKIP_RECHECK;
    int waitedMs = 0;
};

template <typename ReadyFn>
static EndedRevealSkipResult RunAutoAuctionEndedRevealSkipSettleWindow(
    const char* stageLabel,
    ScreenState* state,
    unsigned long long deadlineTick,
    ReadyFn readyFn
) {
    EndedRevealSkipResult result;
    if (!state) return result;

    if (GetTickCount64() >= deadlineTick) {
        result.status = ENDED_REVEAL_SKIP_TIMEOUT;
        return result;
    }

    if (readyFn(*state)) {
        result.status = ENDED_REVEAL_SKIP_READY;
        return result;
    }

    std::string clickError;
    if (!state->battleMainTransform ||
        !ClickNode(state->battleMainTransform, "EndPanel/bg", 0, &clickError)) {
        Logf(
            "AutoAuction ended reveal skip stage=%s bg click failed: %s",
            stageLabel,
            clickError.empty() ? "battleMainTransform missing" : clickError.c_str()
        );
    } else {
        Logf("AutoAuction ended reveal skip stage=%s bg click triggered", stageLabel);
    }

    const unsigned long long startedAt = GetTickCount64();
    const int settleBudgetMs = ClampAutoAuctionEndedRevealSkipWindowMs(
        (int)(deadlineTick > startedAt ? deadlineTick - startedAt : 0ULL)
    );
    const int pollSliceMs = GetAutoAuctionEndedRevealSkipPollSliceMs();

    while (result.waitedMs < settleBudgetMs) {
        const int remainingWindowMs = settleBudgetMs - result.waitedMs;
        const int sleepMs = remainingWindowMs < pollSliceMs ? remainingWindowMs : pollSliceMs;
        if (!SleepInterruptibly(sleepMs)) {
            result.status = ENDED_REVEAL_SKIP_INTERRUPTED;
            return result;
        }

        *state = DetectScreenState();
        result.waitedMs = (int)(GetTickCount64() - startedAt);

        if (IsAutoAuctionVerificationScreen(state->screen)) {
            result.status = ENDED_REVEAL_SKIP_AUTHCODE;
            return result;
        }
        if (!IsAutoAuctionCleanupEndedScreen(state->screen) || !state->battleMainTransform) {
            result.status = ENDED_REVEAL_SKIP_SCREEN_CHANGED;
            return result;
        }
        if (readyFn(*state)) {
            result.status = ENDED_REVEAL_SKIP_READY;
            return result;
        }
    }

    Logf(
        "AutoAuction ended reveal skip stage=%s settle complete waitedMs=%d",
        stageLabel,
        result.waitedMs
    );
    return result;
}
```

- [ ] **Step 2: Replace the Step 7 attempt-count timing with a deadline and invoke the settle helper when winner text or quick recycle is not ready**

```cpp
        const unsigned long long winnerStageDeadline =
            GetTickCount64() + (unsigned long long)GetAutoAuctionEndedWinnerRevealSkipBudgetMs();
        for (int attempt = 0; GetTickCount64() < winnerStageDeadline; ++attempt) {
            if (stopIfRequested()) return;
            ScreenState se = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(se.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup winner detection");
                sendAuthCodeRequired();
                return;
            }
            if (!IsAutoAuctionCleanupEndedScreen(se.screen) || !se.battleMainTransform) break;

            std::string winnerName;
            if (TryReadAutoAuctionEndedWinnerName(se.battleMainTransform, &winnerName) &&
                !winnerName.empty()) {
                winnerResolved = true;
                resolvedWinnerName = winnerName;
                shouldWaitForQuickRecycle = ShouldWaitForQuickRecycle(selfName, winnerName);
                if (!shouldWaitForQuickRecycle) break;
            }

            std::vector<UiNodeSnapshot> huishouM;
            ResolveUiNodeMatches(
                se.battleMainTransform,
                "PanelBattleHuiShouTran/huishou",
                UI_PATH_EXACT,
                1,
                &huishouM
            );
            const bool quickRecycleReady =
                !huishouM.empty() && huishouM[0].active && huishouM[0].components.button;

            if (ShouldAttemptAutoAuctionEndedRevealSkipInWinnerStage(
                    winnerResolved,
                    shouldWaitForQuickRecycle,
                    quickRecycleReady
                )) {
                EndedRevealSkipResult skipResult = RunAutoAuctionEndedRevealSkipSettleWindow(
                    "winner",
                    &se,
                    winnerStageDeadline,
                    [&](const ScreenState& current) -> bool {
                        if (!current.battleMainTransform) return false;
                        if (!winnerResolved) {
                            std::string winnerProbe;
                            return TryReadAutoAuctionEndedWinnerName(current.battleMainTransform, &winnerProbe) &&
                                !winnerProbe.empty();
                        }
                        if (!shouldWaitForQuickRecycle) return true;
                        std::vector<UiNodeSnapshot> probe;
                        ResolveUiNodeMatches(
                            current.battleMainTransform,
                            "PanelBattleHuiShouTran/huishou",
                            UI_PATH_EXACT,
                            1,
                            &probe
                        );
                        return !probe.empty() && probe[0].active && probe[0].components.button;
                    }
                );
                if (skipResult.status == ENDED_REVEAL_SKIP_AUTHCODE) {
                    Logf("AutoAuction interrupted: AuthCode_Main detected during winner-stage reveal skip");
                    sendAuthCodeRequired();
                    return;
                }
                if (skipResult.status == ENDED_REVEAL_SKIP_INTERRUPTED) {
                    stopIfRequested();
                    return;
                }
                if (skipResult.status == ENDED_REVEAL_SKIP_SCREEN_CHANGED) {
                    break;
                }
                continue;
            }

            if (!winnerResolved || !shouldWaitForQuickRecycle) break;
            if (PerformButtonClick(huishouM[0].components.button)) {
                Logf("AutoAuction cleanup clicked quick recycle");
                break;
            }
        }
```

- [ ] **Step 3: Replace the Step 8 implicit 200-attempt timing with a 40s deadline and invoke the settle helper when no ended action path is ready**

```cpp
        const unsigned long long cleanupDeadline =
            GetTickCount64() + (unsigned long long)GetAutoAuctionEndedCleanupRevealSkipBudgetMs();
        for (int attempt = 0; ; ++attempt) {
            const int attemptNumber = attempt + 1;
            if (stopIfRequested()) return;
            if (GetTickCount64() >= cleanupDeadline) {
                SendResponse(c, id, false, "auto_auction_timeout:wait_cleanup_transition");
                return;
            }

            ScreenState se = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(se.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup exit flow");
                sendAuthCodeRequired();
                return;
            }
            if (IsAutoAuctionCleanupCompleteScreen(se.screen)) {
                cleanupComplete = true;
                break;
            }

            if (IsAutoAuctionCleanupEndedScreen(se.screen)) {
                if (!se.battleMainTransform) {
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }
                    continue;
                }

                const char* endedActionPath = PickAutoAuctionEndedPrimaryActionPath(
                    IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/receiveBtn"),
                    IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/continueBtn")
                );
                if (ShouldAttemptAutoAuctionEndedRevealSkipInCleanupStage(endedActionPath)) {
                    EndedRevealSkipResult skipResult = RunAutoAuctionEndedRevealSkipSettleWindow(
                        "cleanup",
                        &se,
                        cleanupDeadline,
                        [&](const ScreenState& current) -> bool {
                            if (!current.battleMainTransform) return false;
                            return PickAutoAuctionEndedPrimaryActionPath(
                                IsButtonNodeReady(current.battleMainTransform, "EndPanel/tuichu/receiveBtn"),
                                IsButtonNodeReady(current.battleMainTransform, "EndPanel/tuichu/continueBtn")
                            ) != nullptr;
                        }
                    );
                    if (skipResult.status == ENDED_REVEAL_SKIP_AUTHCODE) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup reveal skip");
                        sendAuthCodeRequired();
                        return;
                    }
                    if (skipResult.status == ENDED_REVEAL_SKIP_INTERRUPTED) {
                        stopIfRequested();
                        return;
                    }
                    if (skipResult.status == ENDED_REVEAL_SKIP_TIMEOUT && GetTickCount64() >= cleanupDeadline) {
                        SendResponse(c, id, false, "auto_auction_timeout:wait_cleanup_transition");
                        return;
                    }
                    continue;
                }

                std::string e;
                if (!ClickNode(se.battleMainTransform, endedActionPath, 0, &e)) {
                    Logf(
                        "AutoAuction cleanup continue attempt=%d click failed path=%s: %s",
                        attemptNumber,
                        endedActionPath,
                        e.c_str()
                    );
                    SendResponse(c, id, false, "auto_auction_ui_error:wait_cleanup_transition");
                    return;
                }
```

- [ ] **Step 4: Run native and repo verification**

Run:
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_end_skip_agg_test && /tmp/bk_autoauction_end_skip_agg_test"`
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"`
- `npm test`

Expected:
- Aggregate semantics test passes
- `BKAutoOpAgent.dll` rebuilds successfully
- Repo test suite stays green

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "feat: skip autoauction ended reveal during cleanup"
```

### Task 3: Record the ended-screen skip behavior and final verification

**Files:**
- Modify: `Documentation.md`
- Modify: `docs/superpowers/specs/2026-06-28-autoauction-end-screen-skip-design.md`

- [ ] **Step 1: Append the implementation summary and verification commands to `Documentation.md`**

```md
## 2026-06-28 AutoAuction ended-screen skip

- Ended-screen reveal skipping now runs across the full ended-screen tail, not only the primary-action cleanup branch.
- Step 7 winner / quick-recycle waiting now uses a 30s wall-clock deadline.
- Step 8 primary-action waiting now uses a 40s wall-clock deadline.
- Background skip attempts click `EndPanel/bg`, then observe a sliced 300ms settle window instead of blind-sleeping.

### Verification

- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 AggregateOperationSemantics.test.cpp -o /tmp/bk_autoauction_end_skip_agg_test && /tmp/bk_autoauction_end_skip_agg_test"`
- `wsl bash -lc "cd /mnt/a/BidKing/.worktrees/autoauction-end-skip && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"`
- `npm test`
```

- [ ] **Step 2: Update the spec footer only if implementation deviated from the approved names or deadlines**

```md
- Implemented helper names:
  - `GetAutoAuctionEndedWinnerRevealSkipBudgetMs`
  - `GetAutoAuctionEndedCleanupRevealSkipBudgetMs`
  - `RunAutoAuctionEndedRevealSkipSettleWindow`
- Observed settle slice:
  - `50ms`
```

- [ ] **Step 3: Run a final status check**

Run: `git status --short`
Expected: only `Documentation.md`, `AggregateOperationSemantics.h`, `AggregateOperationSemantics.test.cpp`, and `MetaOperations.cpp` remain modified before the last commit.

- [ ] **Step 4: Commit**

```bash
git add Documentation.md docs/superpowers/specs/2026-06-28-autoauction-end-screen-skip-design.md
git commit -m "docs: record autoauction ended reveal skip"
```
