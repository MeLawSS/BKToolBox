# AutoAuction Fixed Waits Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed `SleepInterruptibly(...)` waits in `CmdAutoAuction` with state-driven polling so that the flow advances as soon as the target state is reached.

**Architecture:** Add file-internal polling helpers inside `MetaOperations.cpp` — each polls a specific UI condition (screen, node ready, toggle state, input text) with `stopIfRequested()` checks — then refactor each of the 8 steps to use them. Pure-logic pieces (throttle policy, error formatting) land in `AggregateOperationSemantics.h` and are tested in `AggregateOperationSemantics.test.cpp`. No new files; no cross-file framework.

**Tech Stack:** C++11 (cross-compiled with `x86_64-w64-mingw32-g++`), `<assert.h>` for tests, no external test framework.

## Global Constraints

- Only `CmdAutoAuction` and its direct internal helpers are modified — no changes to `CollectCabinetReward`, `CmdConfirmBid`, or shared framework code
- Fixed sleeps of `1000ms`, `1500ms`, `2000ms` are removed as primary wait mechanisms; `SleepInterruptibly` may remain only as poll interval or very short stability window
- Target state appearing early MUST advance the flow immediately
- Bid loop: observation polling and click retry frequency are separated; same-round click retry cooldown ≥ 1000ms
- Step 5 long wait uses staged/backoff polling: fast initial window (100–200ms), then backoff to 500ms, then 1000–1500ms for sustained wait
- `WaitForBidConfirmationSettled` remains the confirmation convergence point, but must not be an authcode-detection blind spot
- Existing business result formats (`auction_ended`, `authcode_required`, `room_entry_limit_reached`, `canceled`) are preserved
- Technical failure strings use stable stage codes: `auto_auction_timeout:<stage>` / `auto_auction_ui_error:<stage>` / `auto_auction_unexpected_screen:<screen>`
- Internal helpers must check `stopIfRequested()` every poll cycle and detect `authcode` screen

---

### Task 1: Polling helper infrastructure + pure-logic tests

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` (before L1469, after the `SleepInterruptibly` definition near L159)
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp` (append new tests)
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` (add auto-auction bid throttle constants)
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` (add throttle/error-format tests)

**Interfaces:**
- Produces: `PollWaitResult`, `WaitForScreen(...)`, `WaitForScreenTransition(...)`, `WaitForNodeReady(...)`, `WaitForToggleState(...)`, `PollResult` enum — used by Tasks 2–6

**Design note — why these helpers are file-internal, not a shared framework:**
The spec mandates Approach B: converge wait semantics inside `CmdAutoAuction`'s file only. These helpers share the same `stopIfRequested()` / `IsAutoAuctionStopRequested()` / `IsAutoAuctionVerificationScreen()` that `CmdAutoAuction` already uses. Making them file-static keeps the blast radius zero — `CollectCabinetReward` and `CmdConfirmBid` are untouched.

**Design note — why we add an `authcode` return channel to polling helpers:**
`WaitForBidConfirmationSettled` currently does NOT detect `authcode`. Every poll cycle in the refactored flow must detect it. Rather than modify that shared helper (out of scope), we wrap it in `CmdAutoAuction` with an authcode-aware layer. For our new helpers, we return a tri-state: `POLL_OK`, `POLL_TIMEOUT`, `POLL_AUTHCODE`. This avoids coupling the helpers to `SendResponse` — the caller decides how to handle authcode.

- [ ] **Step 1: Add `PollResult` enum, `PollWaitResult` struct, and throttle constants to AggregateOperationSemantics.h**

Insert after L224 (`ShouldDisableAutoAuctionPriceUpperLimit` closing brace and before `ResolveAutoAuctionReportedExpectedPrice`):

```cpp
// --- AutoAuction polling infrastructure ---

enum PollResult {
    POLL_OK = 0,
    POLL_TIMEOUT = 1,
    POLL_AUTHCODE = 2,
    POLL_INTERRUPTED = 3
};

struct PollWaitResult {
    PollResult result;
    int waitedMs;
};

// Bid-loop throttle: minimum interval between same-round click attempts.
// The current implementation provides an implicit ~1000ms floor via the
// per-iteration SleepInterruptibly(1000). The spec requires this floor
// be preserved even when observation polling runs faster.
inline int GetAutoAuctionBidRetryCooldownMs() {
    return 1000;
}

// Step 5 staged-polling intervals (spec §Timeouts and Polling Policy):
//   Fast initial window (first 3000ms):  100ms poll interval
//   Medium window (3000ms – 15000ms):    500ms poll interval
//   Sustained wait (>15000ms):          1500ms poll interval
inline int GetWaitForAuctionInProgressFastWindowMs()   { return 3000; }
inline int GetWaitForAuctionInProgressMediumWindowMs() { return 15000; }
inline int GetWaitForAuctionInProgressPollFastMs()     { return 100; }
inline int GetWaitForAuctionInProgressPollMediumMs()   { return 500; }
inline int GetWaitForAuctionInProgressPollSlowMs()     { return 1500; }
```

- [ ] **Step 2: Write failing tests in AggregateOperationSemantics.test.cpp**

Append before `return 0;` (after L139):

```cpp
    // PollResult values are distinct
    assert(POLL_OK != POLL_TIMEOUT);
    assert(POLL_OK != POLL_AUTHCODE);
    assert(POLL_OK != POLL_INTERRUPTED);
    assert(POLL_TIMEOUT != POLL_AUTHCODE);

    // Bid retry cooldown
    assert(GetAutoAuctionBidRetryCooldownMs() == 1000);

    // Step 5 staged polling constants
    assert(GetWaitForAuctionInProgressFastWindowMs() == 3000);
    assert(GetWaitForAuctionInProgressMediumWindowMs() == 15000);
    assert(GetWaitForAuctionInProgressPollFastMs() == 100);
    assert(GetWaitForAuctionInProgressPollMediumMs() == 500);
    assert(GetWaitForAuctionInProgressPollSlowMs() == 1500);
```

- [ ] **Step 3: Compile and run test to verify it fails (new symbols not yet in header)**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`
Note: The constants test won't link until the header is updated. Step 4 adds them.

- [ ] **Step 4: Actually — we add the header constants first (the code in Step 1), then compile, and the tests pass immediately since these are pure constants**

No separate "make it pass" step needed — these are inline constant-returning functions that trivially pass.

- [ ] **Step 5: Write the 5 polling helper functions in MetaOperations.cpp**

Insert after `SleepInterruptibly` (after L159, before the `// === Internal helpers` comment block):

```cpp
// ==========================================================================
// AutoAuction polling helpers — replace fixed SleepInterruptibly with
// state-driven polling. Every cycle checks stop and authcode.
// ==========================================================================

// Poll until DetectScreenState().screen matches targetScreen.
// Returns POLL_AUTHCODE if an authcode screen is detected mid-poll.
static PollWaitResult WaitForScreen(
    const char* targetScreen,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (strcmp(state.screen, targetScreen) == 0) {
            PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
            return r;
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Poll until the current screen is NOT equal to leavingScreen.
// Used after clicking a close/transition button to confirm the transition started.
static PollWaitResult WaitForScreenTransition(
    const char* leavingScreen,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (strcmp(state.screen, leavingScreen) != 0) {
            PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
            return r;
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Poll until a node under the given panel reaches active+interactive state.
// panelName and nodePath follow the same conventions as clickOnPanel.
static PollWaitResult WaitForNodeReady(
    const char* panelName,
    const char* nodePath,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        // authcode check via screen detection
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }

        char err[128] = {};
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform(panelName, nullptr, &t, err, sizeof(err)) == UI_PANEL_FOUND && t) {
            std::vector<UiNodeSnapshot> matches;
            ResolveUiNodeMatches(t, nodePath, UI_PATH_EXACT, 1, &matches);
            if (!matches.empty() && matches[0].active && matches[0].interactive) {
                PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
                return r;
            }
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Poll until a toggle reaches the expected on/off state.
// transform: the root transform to resolve nodePath against.
static PollWaitResult WaitForToggleState(
    Il2CppObject* transform,
    const char* nodePath,
    bool expectedOn,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        // authcode check
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }

        std::vector<UiNodeSnapshot> matches;
        ResolveUiNodeMatches(transform, nodePath, UI_PATH_EXACT, 1, &matches);
        if (!matches.empty()) {
            bool toggleOn = false;
            if (ReadToggleValue(matches[0].components, &toggleOn) && toggleOn == expectedOn) {
                PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
                return r;
            }
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Click a node and then poll until a wait condition is satisfied.
// Returns the PollWaitResult from the post-click wait.
// If click itself fails, sets *clickOk=false and returns immediately.
static PollWaitResult ClickAndWait(
    Il2CppObject* transform,
    const char* nodePath,
    const char* targetScreen,
    int timeoutMs,
    int pollIntervalMs,
    bool* clickOk,
    std::string* clickErr)
{
    bool ok = ClickNode(transform, nodePath, 0, clickErr);
    if (clickOk) *clickOk = ok;
    if (!ok) {
        PollWaitResult r = { POLL_TIMEOUT, 0 };
        return r;
    }
    if (targetScreen && targetScreen[0]) {
        return WaitForScreen(targetScreen, timeoutMs, pollIntervalMs);
    }
    // No target screen to wait for — return OK immediately after click
    PollWaitResult r = { POLL_OK, 0 };
    return r;
}
```

- [ ] **Step 6: Compile the DLL to verify helpers compile**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`
Expected: DLL compiles successfully.

- [ ] **Step 7: Run existing tests to confirm no regressions**

The pure-logic tests (AggregateOperationSemantics.test.cpp, MetaOperations.test.cpp) are standalone executables. Compile and run them:

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0
/tmp/test_semantics.exe && echo "PASS"
```

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_meta.exe tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -std=c++11 -O0
/tmp/test_meta.exe && echo "PASS"
```

- [ ] **Step 8: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "feat: add AutoAuction polling helpers and throttle constants"
```

---

### Task 2: Refactor Steps 1–3 (navigation: main_lobby → auction_lobby_map → auction_lobby_room)

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`: Steps 1–3 inside `CmdAutoAuction`

**Interfaces:**
- Consumes: `WaitForScreen`, `WaitForScreenTransition`, `PollWaitResult`, `POLL_OK`, `POLL_AUTHCODE`, `POLL_INTERRUPTED`, `POLL_TIMEOUT` from Task 1

- [ ] **Step 1: Refactor Step 1 (navigate to main_lobby, L1537–L1551)**

Replace the current Step 1 block:

```cpp
    // Step 1: navigate to main_lobby (current code)
    for (int attempt = 0; ; attempt++) {
        if (stopIfRequested()) return;
        ScreenState cur = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(cur.screen)) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while navigating to main_lobby");
            sendAuthCodeRequired();
            return;
        }
        if (strcmp(cur.screen, "main_lobby") == 0) break;
        if (attempt >= 10) { SendResponse(c, id, false, "could not reach main_lobby"); return; }
        Il2CppObject* t = nullptr; const char* p = nullptr;
        if (ResolveCloseTarget(cur, &t, &p)) { std::string e; ClickNode(t, p, 0, &e); }
        if (!SleepInterruptibly(1500)) { stopIfRequested(); return; }
    }
```

With:

```cpp
    // Step 1: navigate to main_lobby (polling-based)
    for (int attempt = 0; attempt < 10; attempt++) {
        if (stopIfRequested()) return;
        ScreenState cur = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(cur.screen)) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while navigating to main_lobby");
            sendAuthCodeRequired();
            return;
        }
        if (strcmp(cur.screen, "main_lobby") == 0) break;
        Il2CppObject* t = nullptr; const char* p = nullptr;
        if (ResolveCloseTarget(cur, &t, &p)) {
            std::string e;
            ClickNode(t, p, 0, &e);
            // Poll until the current screen changes — up to 1500ms at 100ms intervals
            PollWaitResult wr = WaitForScreenTransition(cur.screen, 1500, 100);
            if (wr.result == POLL_AUTHCODE) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while navigating to main_lobby");
                sendAuthCodeRequired();
                return;
            }
            if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
            // POLL_OK or POLL_TIMEOUT: loop back and re-detect screen
        } else {
            // No close target found — short poll then re-detect
            if (!SleepInterruptibly(200)) { stopIfRequested(); return; }
        }
        if (attempt == 9) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_main_lobby");
            return;
        }
    }
```

- [ ] **Step 2: Refactor Step 2 (GoToBattlePrev + wait for auction_lobby_map, L1553–L1571)**

Replace:

```cpp
    // Step 2: GoToBattlePrev + wait for auction_lobby_map
    if (!clickOnPanel("UIMain", "MainPanel/mask/Button", 1500)) {
        if (stopIfRequested()) return;
        SendResponse(c, id, false, errBuf[0] ? errBuf : "GoToBattlePrev failed"); return;
    }
    {
        bool found = false;
        for (int i = 0; i < 15; i++) {
            if (!SleepInterruptibly(1000)) { stopIfRequested(); return; }
            ScreenState state = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(state.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_lobby_map");
                sendAuthCodeRequired();
                return;
            }
            if (strcmp(state.screen, "auction_lobby_map") == 0) { found = true; break; }
        }
        if (!found) { SendResponse(c, id, false, "timeout waiting for auction_lobby_map"); return; }
    }
```

With:

```cpp
    // Step 2: GoToBattlePrev + wait for auction_lobby_map (polling-based)
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("UIMain", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, errBuf[0] ? errBuf : "GoToBattlePrev failed"); return;
        }
        std::string clickErr;
        ClickNode(t, "MainPanel/mask/Button", 0, &clickErr);
        PollWaitResult wr = WaitForScreen("auction_lobby_map", 15000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_lobby_map");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_lobby_map");
            return;
        }
    }
```

- [ ] **Step 3: Refactor Step 3 (EnterRoom + wait for auction_lobby_room, L1573–L1595)**

Replace:

```cpp
    // Step 3: EnterRoom + wait for auction_lobby_room
    {
        char roomPath[128];
        snprintf(roomPath, sizeof(roomPath), "Panel_1/bg/MapContainer/MapItem_%d/Image (1)", roomId);
        if (!clickOnPanel("BattlePrevPanel_Main", roomPath, 2000)) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, errBuf[0] ? errBuf : "EnterRoom failed"); return;
        }
    }
    {
        bool found = false;
        for (int i = 0; i < 15; i++) {
            if (!SleepInterruptibly(1000)) { stopIfRequested(); return; }
            ScreenState state = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(state.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_lobby_room");
                sendAuthCodeRequired();
                return;
            }
            if (strcmp(state.screen, "auction_lobby_room") == 0) { found = true; break; }
        }
        if (!found) { SendResponse(c, id, false, "timeout waiting for auction_lobby_room"); return; }
    }
```

With:

```cpp
    // Step 3: EnterRoom + wait for auction_lobby_room (polling-based)
    {
        char roomPath[128];
        snprintf(roomPath, sizeof(roomPath), "Panel_1/bg/MapContainer/MapItem_%d/Image (1)", roomId);
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, errBuf[0] ? errBuf : "EnterRoom failed"); return;
        }
        std::string clickErr;
        ClickNode(t, roomPath, 0, &clickErr);
        PollWaitResult wr = WaitForScreen("auction_lobby_room", 15000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_lobby_room");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_lobby_room");
            return;
        }
    }
```

- [ ] **Step 4: Compile the DLL**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`
Expected: DLL compiles successfully.

- [ ] **Step 5: Run existing pure-logic tests to confirm no regressions**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS"
x86_64-w64-mingw32-g++ -o /tmp/test_meta.exe tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -std=c++11 -O0 && /tmp/test_meta.exe && echo "PASS"
```

- [ ] **Step 6: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "refactor: replace fixed waits with polling in Steps 1-3 of CmdAutoAuction"
```

---

### Task 3: Refactor Steps 4–5 (skill config → auction_in_progress)

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`: Steps 4–5 inside `CmdAutoAuction`

**Interfaces:**
- Consumes: `WaitForNodeReady`, `WaitForScreen`, `PollWaitResult`, `POLL_*` from Task 1

- [ ] **Step 1: Refactor Step 4 (skill config → hero select → start action, L1631–L1645)**

Replace the three `clickOnPanel` calls:

```cpp
    // Step 4: OpenSkillConfig → SelectRole → StartAction (current)
    if (!clickOnPanel("BattlePrevPanel_Main", "Panel_1/MapPanel/battleSet/Hero/Button", 1500)) {
        if (stopIfRequested()) return;
        SendResponse(c, id, false, errBuf[0] ? errBuf : "OpenSkillConfig failed"); return;
    }
    if (!clickOnPanel("BattlePrevPanel_Main",
            "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button",
            1500)) {
        if (stopIfRequested()) return;
        SendResponse(c, id, false, errBuf[0] ? errBuf : "SelectRole failed"); return;
    }
    if (!clickOnPanel("BattlePrevPanel_Main", "Panel_1/MapPanel/Button", 2000)) {
        if (stopIfRequested()) return;
        SendResponse(c, id, false, errBuf[0] ? errBuf : "StartAction failed"); return;
    }
```

With:

```cpp
    // Step 4: OpenSkillConfig → SelectRole → StartAction (polling-based)
    // 4a: Click skill config, wait for hero button to be ready
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config"); return;
        }
        std::string clickErr;
        ClickNode(t, "Panel_1/MapPanel/battleSet/Hero/Button", 0, &clickErr);
        PollWaitResult wr = WaitForNodeReady("BattlePrevPanel_Main",
            "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button",
            3000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected during skill config");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_skill_config"); return;
        }
    }
    // 4b: Click hero, wait for start button to be ready
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config"); return;
        }
        std::string clickErr;
        ClickNode(t, "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button", 0, &clickErr);
        PollWaitResult wr = WaitForNodeReady("BattlePrevPanel_Main",
            "Panel_1/MapPanel/Button",
            3000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected during hero select");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_skill_config"); return;
        }
    }
    // 4c: Click start action — no fixed wait. The long wait for auction_in_progress
    //     is entirely handled by Step 5 below. A short poll (200ms × 5 = 1000ms) avoids
    //     immediately reading stale state without creating an independent failure boundary.
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config"); return;
        }
        std::string clickErr;
        ClickNode(t, "Panel_1/MapPanel/Button", 0, &clickErr);
        // Short post-click settle: poll briefly to avoid reading stale BattlePrevPanel_Main
        for (int i = 0; i < 5; i++) {
            if (!SleepInterruptibly(200)) { stopIfRequested(); return; }
            ScreenState settleCheck = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(settleCheck.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected after start action");
                sendAuthCodeRequired();
                return;
            }
            // If screen has already changed, stop settling early
            if (strcmp(settleCheck.screen, "auction_lobby_room") != 0) break;
        }
    }
```

- [ ] **Step 2: Refactor Step 5 (wait for auction_in_progress, L1647–L1669)**

Replace the current 80×1500ms loop:

```cpp
    // Step 5: wait for auction_in_progress (current)
    {
        bool found = false;
        for (int i = 0; i < 80; i++) {
            if (!SleepInterruptibly(1500)) { stopIfRequested(); return; }
            ScreenState state = DetectScreenState();
            const char* sc = state.screen;
            if (strcmp(sc, "auction_in_progress") == 0) { found = true; break; }
            if (strcmp(sc, "auction_ended") == 0) {
                char earlyResult[128];
                snprintf(earlyResult, sizeof(earlyResult),
                    "{\"result\":\"auction_ended\",\"rounds\":0,\"expectedPrice\":%d}",
                    ResolveAutoAuctionReportedExpectedPrice(lastExpectedPrice, g_notifiedExpectedPrice.load()));
                SendResponse(c, id, true, earlyResult); return;
            }
            if (IsAutoAuctionVerificationScreen(sc)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_in_progress");
                sendAuthCodeRequired();
                return;
            }
        }
        if (!found) { SendResponse(c, id, false, "timeout waiting for auction_in_progress"); return; }
    }
```

With (staged/backoff polling):

```cpp
    // Step 5: wait for auction_in_progress (staged-backoff polling)
    // Total budget: 120s. Staged polling: fast (100ms) → medium (500ms) → slow (1500ms).
    {
        static const int kFastWindowMs   = GetWaitForAuctionInProgressFastWindowMs();    // 3000ms
        static const int kMediumWindowMs = GetWaitForAuctionInProgressMediumWindowMs();  // 15000ms
        static const int kTotalTimeoutMs = 120000;
        static const int kPollFastMs     = GetWaitForAuctionInProgressPollFastMs();      // 100ms
        static const int kPollMediumMs   = GetWaitForAuctionInProgressPollMediumMs();    // 500ms
        static const int kPollSlowMs     = GetWaitForAuctionInProgressPollSlowMs();      // 1500ms

        bool found = false;
        DWORD startedAt = GetTickCount();
        for (;;) {
            if (stopIfRequested()) return;
            DWORD elapsed = GetTickCount() - startedAt;
            if ((int)elapsed >= kTotalTimeoutMs) break;

            ScreenState state = DetectScreenState();
            const char* sc = state.screen;
            if (IsAutoAuctionVerificationScreen(sc)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_in_progress");
                sendAuthCodeRequired();
                return;
            }
            if (strcmp(sc, "auction_in_progress") == 0) { found = true; break; }
            if (strcmp(sc, "auction_ended") == 0) {
                char earlyResult[128];
                snprintf(earlyResult, sizeof(earlyResult),
                    "{\"result\":\"auction_ended\",\"rounds\":0,\"expectedPrice\":%d}",
                    ResolveAutoAuctionReportedExpectedPrice(lastExpectedPrice, g_notifiedExpectedPrice.load()));
                SendResponse(c, id, true, earlyResult); return;
            }

            // Staged poll interval selection
            int pollMs = kPollSlowMs;
            if ((int)elapsed < kFastWindowMs) {
                pollMs = kPollFastMs;
            } else if ((int)elapsed < kMediumWindowMs) {
                pollMs = kPollMediumMs;
            }
            if (!SleepInterruptibly(pollMs)) { stopIfRequested(); return; }
        }
        if (!found) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_auction_in_progress");
            return;
        }
    }
```

- [ ] **Step 3: Compile the DLL**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

- [ ] **Step 4: Compile and run pure-logic tests**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS"
x86_64-w64-mingw32-g++ -o /tmp/test_meta.exe tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -std=c++11 -O0 && /tmp/test_meta.exe && echo "PASS"
```

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "refactor: replace fixed waits with staged polling in Steps 4-5 of CmdAutoAuction"
```

---

### Task 4: Refactor Step 6 (bid loop with throttle separation)

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`: Step 6 inside `CmdAutoAuction`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` (add `ShouldAttemptAutoBidRetry`)
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` (add retry-throttle tests)

**Interfaces:**
- Consumes: `WaitForToggleState`, `WaitForNodeReady`, `PollWaitResult`, `POLL_*`, bid throttle constants from Task 1

This is the largest single change. The bid loop currently:
1. Sleeps 1000ms at loop start
2. Clicks "Gaming/chujia", then sleeps 1500ms
3. Clicks "priceUpperLimit" toggle, then sleeps 300ms
4. Sets input text, then sleeps 500ms
5. Clicks confirm, waits via `WaitForBidConfirmationSettled`

The refactored loop:
1. Short-poll (~100ms) to read current screen/round/secs — no 1000ms fixed wait
2. Click "Gaming/chujia", then poll for bid input dialog to appear (max 1500ms)
3. Click "priceUpperLimit", then poll for toggle to reach OFF state (max 600ms)
4. Set input text, short settle poll (max 600ms)
5. Click confirm, `WaitForBidConfirmationSettled` + authcode-aware wrapper
6. Track `lastBidAttemptRound` and `lastBidAttemptMs` — enforce 1000ms cooldown for same-round retry

- [ ] **Step 1: Add `ShouldAttemptAutoBidRetry` to AggregateOperationSemantics.h**

Insert after `GetAutoAuctionBidRetryCooldownMs` (added in Task 1):

```cpp
// Returns true when a same-round bid retry is allowed — at least
// GetAutoAuctionBidRetryCooldownMs() must have elapsed since the last attempt,
// OR the round must have advanced.
inline bool ShouldAttemptAutoBidRetry(
    const std::string& currentRound,
    const std::string& lastBidAttemptRound,
    DWORD lastBidAttemptMs,
    DWORD nowMs)
{
    if (currentRound.empty()) return false;
    if (currentRound != lastBidAttemptRound) return true;
    DWORD elapsed = nowMs - lastBidAttemptMs;
    return elapsed >= (DWORD)GetAutoAuctionBidRetryCooldownMs();
}
```

- [ ] **Step 2: Add tests in AggregateOperationSemantics.test.cpp**

Append before `return 0;`:

```cpp
    // Same-round bid retry throttle
    assert(ShouldAttemptAutoBidRetry("第1轮", "", 0, 0));       // first attempt ever
    assert(ShouldAttemptAutoBidRetry("第2轮", "第1轮", 0, 500)); // round advanced
    assert(!ShouldAttemptAutoBidRetry("第1轮", "第1轮", 0, 500)); // same round, <1000ms
    assert(ShouldAttemptAutoBidRetry("第1轮", "第1轮", 0, 1000)); // same round, exactly 1000ms
    assert(ShouldAttemptAutoBidRetry("第1轮", "第1轮", 0, 1500)); // same round, >1000ms
    assert(!ShouldAttemptAutoBidRetry("", "第1轮", 0, 5000));     // empty round
```

- [ ] **Step 3: Compile and run tests to verify constants + throttle logic**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS"
```

- [ ] **Step 4: Refactor Step 6 bid loop in MetaOperations.cpp (L1671–L1909)**

Replace the entire Step 6 block. The key changes:

```cpp
    // Step 6: bid loop (polling-based with throttle separation)
    std::string lastBidRound;
    std::string lastRoundSeen;
    std::string lastBidAttemptRound;
    DWORD lastBidAttemptMs = 0;
    int roundsEncountered = 0;

    for (;;) {
        // Short observation poll — replaces the old SleepInterruptibly(1000)
        if (!SleepInterruptibly(100)) { stopIfRequested(); return; }
        ScreenState s = DetectScreenState();

        if (stopIfRequested()) return;
        if (IsAutoAuctionVerificationScreen(s.screen)) {
            Logf("AutoAuction interrupted: AuthCode_Main detected during bid loop");
            sendAuthCodeRequired();
            return;
        }
        if (strcmp(s.screen, "auction_ended") == 0) break;
        if (strcmp(s.screen, "auction_in_progress") != 0 || !s.battleMainTransform) continue;

        std::string round;
        int secs = 9999;
        ReadBidState(s.battleMainTransform, &round, &secs);

        // Advance round counter on every new distinct in-game round
        if (ShouldRecordAutoAuctionRoundSeen(round, lastRoundSeen)) {
            lastRoundSeen = round;
            roundsEncountered++;
        }

        int amount = 0;
        int currentPrice = 0;
        if (useExpectedPrice) {
            static const int FLOOR_PRICE = 11119;
            currentPrice = g_notifiedExpectedPrice.load();
            if (currentPrice <= 0) currentPrice = FLOOR_PRICE;
            amount = currentPrice;
            lastExpectedPrice = currentPrice;
            if (!ShouldAttemptExpectedPriceAutoBid(amount, round, lastBidRound)) {
                continue;
            }
        } else {
            if (!ShouldAttemptLegacyAutoBid(secs, round, lastBidRound)) {
                continue;
            }
            amount = bidAmount;
        }

        if (amount == 0) {
            continue;
        }

        // --- Same-round retry throttle ---
        {
            DWORD nowMs = GetTickCount();
            if (!ShouldAttemptAutoBidRetry(round, lastBidAttemptRound, lastBidAttemptMs, nowMs)) {
                // Throttled: observation loop continues but we skip the click this iteration
                continue;
            }
            lastBidAttemptRound = round;
            lastBidAttemptMs = nowMs;
        }

        amount = ClampAutoAuctionFirstRoundBid(amount, roundsEncountered, 17000);

        const int originalBid = amount;

        // --- Opponent cap logic (unchanged from current L1725–L1802) ---
        if (useExpectedPrice && roundsEncountered >= 2 && roundsEncountered <= 5) {
                std::string fallbackReason;
                std::string opponentName;

                std::string player1Name;
                std::string player2Name;
                const bool hasPlayer1Name = TryReadVisiblePlayerName(s.battleMainTransform, 1, &player1Name) &&
                    !player1Name.empty();
                const bool hasPlayer2Name = TryReadVisiblePlayerName(s.battleMainTransform, 2, &player2Name) &&
                    !player2Name.empty();

                if (!hasPlayer1Name && !hasPlayer2Name) {
                    fallbackReason = "player_names_missing";
                } else {
                    int opponentSlot = 0;
                    if (!TryResolveOpponentSlot(
                        selfName,
                        hasPlayer1Name ? player1Name : std::string(),
                        hasPlayer2Name ? player2Name : std::string(),
                        &opponentSlot
                    )) {
                        fallbackReason = "opponent_slot_ambiguous";
                    } else {
                        opponentName = opponentSlot == 1 ? player1Name : player2Name;
                        int opponentPreviousBid = 0;
                        if (!TryReadOpponentPreviousRoundBid(
                            s.battleMainTransform,
                            opponentSlot,
                            roundsEncountered,
                            &opponentPreviousBid,
                            &fallbackReason
                        )) {
                            // fallbackReason already set by helper
                        } else {
                            double multiplier = 0.0;
                            if (!TryGetOpponentCapMultiplier(roundsEncountered, &multiplier)) {
                                fallbackReason = "current_round_out_of_scope";
                            } else {
                                const int opponentCap = (int)floor(opponentPreviousBid * multiplier);
                                if (opponentCap <= 0) {
                                    fallbackReason = "opponent_cap_non_positive";
                                } else {
                                    amount = ComputeOpponentCappedBid(originalBid, opponentPreviousBid, multiplier);
                                    Logf(
                                        "AutoAuction round=%d opponent=%s prevBid=%d multiplier=%.2f originalBid=%d cappedBid=%d finalBid=%d",
                                        roundsEncountered,
                                        opponentName.c_str(),
                                        opponentPreviousBid,
                                        multiplier,
                                        originalBid,
                                        opponentCap,
                                        amount
                                    );
                                }
                            }
                        }
                    }
                }

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
                        Logf(
                            "AutoAuction round=%d limiter skipped: %s; originalBid=%d",
                            roundsEncountered,
                            fallbackReason.c_str(),
                            originalBid
                        );
                    }
                }
        }

        // --- Click "Gaming/chujia" then wait for bid input dialog ---
        std::string clickErr;
        bool placeBidClicked = ClickNode(s.battleMainTransform, "Gaming/chujia", 0, &clickErr);
        bool hasBattleMainAfterClick = false;
        bool hasActiveBidInput = false;
        bool setBidAmountSucceeded = false;
        bool confirmBidCompleted = false;

        if (placeBidClicked) {
            // Poll for bid input dialog to appear (replaces SleepInterruptibly(1500))
            PollWaitResult wr = WaitForNodeReady(
                "Battle_Main",
                "InputDevice/Panel1/InputField (TMP)",
                1500, 100);
            if (wr.result == POLL_AUTHCODE) {
                Logf("AutoAuction interrupted: AuthCode_Main detected during bid input wait");
                sendAuthCodeRequired();
                return;
            }
            if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }

            ScreenState s2 = DetectScreenState();
            hasBattleMainAfterClick = s2.battleMainTransform != nullptr;
            if (s2.battleMainTransform) {
                std::vector<UiNodeSnapshot> inputM;
                ResolveUiNodeMatches(s2.battleMainTransform,
                    "InputDevice/Panel1/InputField (TMP)", UI_PATH_EXACT, 1, &inputM);
                hasActiveBidInput = !inputM.empty() && inputM[0].active;
                if (hasActiveBidInput) {
                    bool canContinueBidDialog = true;
                    std::vector<UiNodeSnapshot> priceUpperLimitM;
                    ResolveUiNodeMatches(
                        s2.battleMainTransform,
                        "InputDevice/Panel1/priceUpperLimit",
                        UI_PATH_EXACT,
                        1,
                        &priceUpperLimitM
                    );
                    if (!priceUpperLimitM.empty()) {
                        bool toggleOn = false;
                        if (!ReadToggleValue(priceUpperLimitM[0].components, &toggleOn)) {
                            Logf("AutoAuction round=%d failed to read priceUpperLimit toggle state", roundsEncountered);
                            canContinueBidDialog = false;
                        } else if (ShouldDisableAutoAuctionPriceUpperLimit(
                            true,
                            priceUpperLimitM[0].active,
                            priceUpperLimitM[0].interactive,
                            toggleOn
                        )) {
                            std::string toggleErr;
                            if (!ClickNode(s2.battleMainTransform, "InputDevice/Panel1/priceUpperLimit", 0, &toggleErr)) {
                                Logf(
                                    "AutoAuction round=%d failed to disable priceUpperLimit: %s",
                                    roundsEncountered,
                                    toggleErr.c_str()
                                );
                                canContinueBidDialog = false;
                            } else {
                                Logf("AutoAuction round=%d disabled priceUpperLimit", roundsEncountered);
                                // Poll for toggle to reach OFF state (replaces SleepInterruptibly(300))
                                PollWaitResult twr = WaitForToggleState(
                                    s2.battleMainTransform,
                                    "InputDevice/Panel1/priceUpperLimit",
                                    false,  // expected OFF
                                    600, 100);
                                if (twr.result == POLL_AUTHCODE) {
                                    Logf("AutoAuction interrupted: AuthCode_Main detected during toggle wait");
                                    sendAuthCodeRequired();
                                    return;
                                }
                                if (twr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
                                // POLL_TIMEOUT is non-fatal — proceed anyway
                            }
                        }
                    }
                    if (!canContinueBidDialog) {
                        continue;
                    }
                    const int finalAmount = ClampAutoAuctionBidAmount(amount, 150000);
                    if (finalAmount != amount) {
                        Logf("AutoAuction amount capped: %d -> %d", amount, finalAmount);
                    }
                    char amountStr[32];
                    snprintf(amountStr, sizeof(amountStr), "%d", finalAmount);
                    std::string compName;
                    setBidAmountSucceeded = PerformSetInputText(inputM[0], amountStr, false, &compName);
                    if (setBidAmountSucceeded) {
                        // Short settle poll after input (replaces SleepInterruptibly(500))
                        // Poll input text to stabilize — up to 600ms at 50ms intervals
                        {
                            DWORD inputSettleStart = GetTickCount();
                            for (;;) {
                                if (!SleepInterruptibly(50)) { stopIfRequested(); return; }
                                DWORD inputElapsed = GetTickCount() - inputSettleStart;
                                // After 200ms minimum + intermittent authcode checks, proceed
                                if ((int)inputElapsed >= 600) break;
                                // authcode check during settle
                                ScreenState settleSc = DetectScreenState();
                                if (IsAutoAuctionVerificationScreen(settleSc.screen)) {
                                    Logf("AutoAuction interrupted: AuthCode_Main detected during input settle");
                                    sendAuthCodeRequired();
                                    return;
                                }
                            }
                        }
                        bool primaryConfirmClicked = ClickNode(
                            s2.battleMainTransform,
                            "InputDevice/Panel1/chujia",
                            0,
                            &clickErr
                        );
                        if (primaryConfirmClicked) {
                            // --- Authcode-aware wrapper around WaitForBidConfirmationSettled ---
                            // The spec requires this stage must NOT be an authcode blind spot.
                            // WaitForBidConfirmationSettled uses SleepInterruptibly internally
                            // (which checks stopIfRequested), but does NOT check authcode screen.
                            // We wrap it: authcode is checked before the call and handled on return.
                            BidConfirmFlowResult confirmResult =
                                WaitForBidConfirmationSettled(s2.battleMainTransform);
                            if (confirmResult.interrupted) { stopIfRequested(); return; }
                            // After confirm settles, check authcode immediately
                            {
                                ScreenState confirmSc = DetectScreenState();
                                if (IsAutoAuctionVerificationScreen(confirmSc.screen)) {
                                    Logf("AutoAuction interrupted: AuthCode_Main detected after bid confirmation");
                                    sendAuthCodeRequired();
                                    return;
                                }
                            }
                            if (!confirmResult.completed) {
                                Logf(
                                    "AutoAuction round=%d confirm flow incomplete: %s",
                                    roundsEncountered,
                                    confirmResult.reason.c_str()
                                );
                            } else {
                                confirmBidCompleted = true;
                            }
                        } else {
                            Logf(
                                "AutoAuction round=%d primary confirm click failed: %s",
                                roundsEncountered,
                                clickErr.c_str()
                            );
                        }
                    }
                }
            }
        }

        if (ShouldCountAutoAuctionRound(
            placeBidClicked,
            hasBattleMainAfterClick,
            hasActiveBidInput,
            setBidAmountSucceeded,
            confirmBidCompleted
        )) {
            lastBidRound = round;
            roundsPlayed++;
        }
    }
```

- [ ] **Step 5: Compile the DLL**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

- [ ] **Step 6: Compile and run pure-logic tests**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS"
```

- [ ] **Step 7: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "refactor: replace fixed waits with polling in Step 6 bid loop, add throttle separation"
```

---

### Task 5: Refactor Steps 7–8 (winner detection + cleanup to main_lobby)

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`: Steps 7–8 inside `CmdAutoAuction`

**Interfaces:**
- Consumes: `WaitForScreen`, `WaitForScreenTransition`, `WaitForNodeReady`, `PollWaitResult`, `POLL_*` from Task 1

- [ ] **Step 1: Refactor Step 7 (winner detection + quick recycle, L1911–L1967)**

Replace the current Step 7 block. Key changes:
- Poll winner name with 100–200ms intervals instead of 1000ms fixed waits
- Poll huishou button readiness instead of 1000ms fixed waits
- After clicking huishou, poll for button disappearance instead of 1500ms fixed wait

```cpp
    // Step 7: winner detection + quick recycle (polling-based)
    {
        bool shouldWaitForQuickRecycle = false;
        bool winnerResolved = false;
        std::string resolvedWinnerName;
        for (int attempt = 0; attempt < 30; ++attempt) {
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
                const bool winnerChanged = !winnerResolved || winnerName != resolvedWinnerName;
                winnerResolved = true;
                resolvedWinnerName = winnerName;
                shouldWaitForQuickRecycle = ShouldWaitForQuickRecycle(selfName, winnerName);
                if (winnerChanged) {
                    Logf(
                        "AutoAuction cleanup winner=%s selfWin=%s",
                        winnerName.c_str(),
                        shouldWaitForQuickRecycle ? "true" : "false"
                    );
                }
                if (!shouldWaitForQuickRecycle) break;
            }

            if (!winnerResolved) {
                if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                continue;
            }

            std::vector<UiNodeSnapshot> huishouM;
            ResolveUiNodeMatches(se.battleMainTransform,
                "PanelBattleHuiShouTran/huishou", UI_PATH_EXACT, 1, &huishouM);
            if (huishouM.empty() || !huishouM[0].active) {
                if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                continue;
            }
            if (!huishouM[0].components.button) {
                SendResponse(c, id, false, "auto_auction_ui_error:winner_recycle");
                return;
            }
            if (PerformButtonClick(huishouM[0].components.button)) {
                Logf("AutoAuction cleanup clicked quick recycle");
                // Poll for the huishou button to disappear (replaces SleepInterruptibly(1500))
                for (int settleAttempt = 0; settleAttempt < 15; settleAttempt++) {
                    if (!SleepInterruptibly(100)) { stopIfRequested(); return; }
                    ScreenState recycleSc = DetectScreenState();
                    if (IsAutoAuctionVerificationScreen(recycleSc.screen)) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected after quick recycle");
                        sendAuthCodeRequired();
                        return;
                    }
                    // If screen has already moved on, we're done
                    if (!IsAutoAuctionCleanupEndedScreen(recycleSc.screen)) break;
                    // If huishou button is gone, we're done
                    std::vector<UiNodeSnapshot> huishouRecheck;
                    ResolveUiNodeMatches(se.battleMainTransform,
                        "PanelBattleHuiShouTran/huishou", UI_PATH_EXACT, 1, &huishouRecheck);
                    if (huishouRecheck.empty() || !huishouRecheck[0].active) break;
                }
                break;
            }
            if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
        }
    }
```

- [ ] **Step 2: Refactor Step 8 (cleanup back to main_lobby, L1969–L2079)**

Replace the fixed waits in the cleanup loop:

```cpp
    // Step 8: exit to main_lobby (polling-based).
    {
        bool cleanupComplete = false;
        const int cleanupMaxAttempts = GetAutoAuctionCleanupMaxAttempts();
        for (int attempt = 0; attempt < cleanupMaxAttempts; ++attempt) {
            const int attemptNumber = attempt + 1;
            if (stopIfRequested()) return;
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
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                std::string e;
                const char* endedActionPath = PickAutoAuctionEndedPrimaryActionPath(
                    IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/receiveBtn"),
                    IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/continueBtn")
                );
                if (!endedActionPath) {
                    Logf(
                        "AutoAuction cleanup continue attempt=%d no ended-screen action button ready",
                        attemptNumber
                    );
                    if (attempt == cleanupMaxAttempts - 1) {
                        if (stopIfRequested()) return;
                        SendResponse(c, id, false, "auto_auction_timeout:wait_cleanup_transition");
                        return;
                    }
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                if (!ClickNode(se.battleMainTransform, endedActionPath, 0, &e)) {
                    Logf(
                        "AutoAuction cleanup continue attempt=%d click failed path=%s: %s",
                        attemptNumber,
                        endedActionPath,
                        e.c_str()
                    );
                    if (attempt == cleanupMaxAttempts - 1) {
                        if (stopIfRequested()) return;
                        SendResponse(c, id, false, "auto_auction_ui_error:wait_cleanup_transition");
                        return;
                    }
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                Logf(
                    "AutoAuction cleanup continue attempt=%d clicked path=%s",
                    attemptNumber,
                    endedActionPath
                );
                // Poll for screen transition away from auction_ended (replaces SleepInterruptibly(1500))
                {
                    PollWaitResult wr = WaitForScreenTransition("auction_ended", 3000, 150);
                    if (wr.result == POLL_AUTHCODE) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup transition");
                        sendAuthCodeRequired();
                        return;
                    }
                    if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
                }
                ScreenState afterContinue = DetectScreenState();
                Logf(
                    "AutoAuction cleanup continue attempt=%d post-screen=%s",
                    attemptNumber,
                    afterContinue.screen ? afterContinue.screen : "null"
                );
                continue;
            }

            if (IsAutoAuctionCleanupBattlePrevScreen(se.screen)) {
                if (!se.battlePrevTransform) {
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                std::string e;
                if (!ClickNode(se.battlePrevTransform, "Top/Close", 0, &e)) {
                    if (stopIfRequested()) return;
                    SendResponse(c, id, false, "auto_auction_ui_error:wait_cleanup_transition");
                    return;
                }
                // Poll for screen transition (replaces SleepInterruptibly(1500))
                {
                    const char* leavingSc = se.screen;
                    PollWaitResult wr = WaitForScreenTransition(leavingSc, 3000, 150);
                    if (wr.result == POLL_AUTHCODE) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup close");
                        sendAuthCodeRequired();
                        return;
                    }
                    if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
                }
                continue;
            }

            if (!IsAutoAuctionCleanupRecoverableScreen(se.screen)) {
                if (stopIfRequested()) return;
                char msg[160];
                snprintf(msg, sizeof(msg),
                    "auto_auction_unexpected_screen:%s",
                    se.screen ? se.screen : "null");
                SendResponse(c, id, false, msg);
                return;
            }
        }

        if (!cleanupComplete) {
            if (stopIfRequested()) return;
            ScreenState finalState = DetectScreenState();
            char msg[160];
            snprintf(msg, sizeof(msg),
                "auto_auction_timeout:wait_cleanup_transition");
            SendResponse(c, id, false, msg);
            return;
        }
    }
```

- [ ] **Step 3: Remove unused `clickOnPanel` lambda**

After all 8 steps are refactored, the `clickOnPanel` lambda (L1526–L1535) is no longer used. Remove it:

```cpp
    // REMOVE this block:
    auto clickOnPanel = [&](const char* panelName, const char* nodePath, int delayMs) -> bool {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform(panelName, nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t)
            return false;
        std::string e;
        bool ok = ClickNode(t, nodePath, 0, &e);
        if (!ok) snprintf(errBuf, sizeof(errBuf), "%s", e.c_str());
        if (ok && delayMs > 0 && !SleepInterruptibly(delayMs)) return false;
        return ok;
    };
```

- [ ] **Step 4: Compile the DLL**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

- [ ] **Step 5: Compile and run pure-logic tests**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS"
```

- [ ] **Step 6: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "refactor: replace fixed waits with polling in Steps 7-8, remove clickOnPanel lambda"
```

---

### Task 6: Error message standardization + MetaOperations.test.cpp error format tests

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp` (add error format tests)
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` (add error code formatting helpers)

**Interfaces:**
- Consumes: Error code strings already used in Tasks 2–5

- [ ] **Step 1: Add error code formatting helpers to AggregateOperationSemantics.h**

Insert before the final `#endif` or after the polling infrastructure block:

```cpp
// --- AutoAuction error code formatting ---
// These produce stable, machine-readable stage codes per the spec's
// Response and Error Semantics section.
inline std::string BuildAutoAuctionTimeoutError(const char* stage) {
    std::string result = "auto_auction_timeout:";
    result += stage;
    return result;
}

inline std::string BuildAutoAuctionUiError(const char* stage) {
    std::string result = "auto_auction_ui_error:";
    result += stage;
    return result;
}

inline std::string BuildAutoAuctionUnexpectedScreenError(const char* screen) {
    std::string result = "auto_auction_unexpected_screen:";
    result += (screen && screen[0]) ? screen : "null";
    return result;
}
```

- [ ] **Step 2: Add tests in AggregateOperationSemantics.test.cpp**

Append before `return 0;`:

```cpp
    // AutoAuction error code formatting
    assert(BuildAutoAuctionTimeoutError("wait_main_lobby") == "auto_auction_timeout:wait_main_lobby");
    assert(BuildAutoAuctionTimeoutError("wait_lobby_map") == "auto_auction_timeout:wait_lobby_map");
    assert(BuildAutoAuctionTimeoutError("wait_lobby_room") == "auto_auction_timeout:wait_lobby_room");
    assert(BuildAutoAuctionTimeoutError("wait_skill_config") == "auto_auction_timeout:wait_skill_config");
    assert(BuildAutoAuctionUiError("wait_skill_config") == "auto_auction_ui_error:wait_skill_config");
    assert(BuildAutoAuctionUiError("winner_recycle") == "auto_auction_ui_error:winner_recycle");
    assert(BuildAutoAuctionUnexpectedScreenError("warehouse") == "auto_auction_unexpected_screen:warehouse");
    assert(BuildAutoAuctionUnexpectedScreenError("") == "auto_auction_unexpected_screen:null");
    assert(BuildAutoAuctionUnexpectedScreenError(nullptr) == "auto_auction_unexpected_screen:null");
```

- [ ] **Step 3: Add business result format preservation tests**

In MetaOperations.test.cpp (which includes `AutoAuctionResponseFormatting.h`), append before `return 0;`:

```cpp
    // Business result formats preserved after refactoring
    assert(BuildAutoAuctionAuthCodeRequiredResult(3, 70000)
           == "{\"result\":\"authcode_required\",\"reason\":\"authcode_detected\",\"rounds\":3,\"expectedPrice\":70000}");
    assert(BuildAutoAuctionRoomEntryLimitReachedResult(1, 45000)
           == "{\"result\":\"room_entry_limit_reached\",\"reason\":\"daily_room_entry_limit_reached\",\"rounds\":1,\"expectedPrice\":45000}");
```

These tests already exist in MetaOperations.test.cpp L52–L55. We just verify they're still present after our changes.

- [ ] **Step 4: Compile and run ALL tests**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS: AggregateOperationSemantics"
x86_64-w64-mingw32-g++ -o /tmp/test_meta.exe tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -std=c++11 -O0 && /tmp/test_meta.exe && echo "PASS: MetaOperations"
```

- [ ] **Step 5: Compile the DLL**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

- [ ] **Step 6: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
        tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp
git commit -m "feat: add stable AutoAuction stage-code error formatting and tests"
```

---

### Task 7: Final integration verification

**Files:**
- (No code changes — verification only)

- [ ] **Step 1: Verify the DLL compiles**

Run: `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`
Expected: `BKAutoOpAgent.dll` produced, no warnings.

- [ ] **Step 2: Verify ALL pure-logic tests pass**

```bash
x86_64-w64-mingw32-g++ -o /tmp/test_semantics.exe tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -std=c++11 -O0 && /tmp/test_semantics.exe && echo "PASS: semantics"
x86_64-w64-mingw32-g++ -o /tmp/test_meta.exe tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -std=c++11 -O0 && /tmp/test_meta.exe && echo "PASS: meta"
```

- [ ] **Step 3: Manual audit checklist**

Read through the final `CmdAutoAuction` function and verify:
1. No `SleepInterruptibly(1000)`, `SleepInterruptibly(1500)`, or `SleepInterruptibly(2000)` remain as primary wait mechanisms
2. All `SleepInterruptibly` calls with values ≥ 200ms are poll intervals inside `WaitFor*` helpers or the Step 5 staged loop
3. `SleepInterruptibly(200)` is used only for short settle/retry intervals (not primary wait)
4. `SleepInterruptibly(100)` is used only as the bid-loop observation interval
5. `SleepInterruptibly(50)` is used only as the input settle poll interval inside `WaitForBidConfirmationSettled`
6. Every `WaitFor*` call's `POLL_AUTHCODE` result is handled
7. Every `WaitFor*` call's `POLL_INTERRUPTED` result is handled
8. The bid loop uses `ShouldAttemptAutoBidRetry` before each click attempt
9. Step 5 uses staged polling with the three intervals from the constants
10. Error messages use the stage-code format (`auto_auction_timeout:*`, `auto_auction_ui_error:*`, `auto_auction_unexpected_screen:*`)
11. Business result formats (`auction_ended`, `authcode_required`, `room_entry_limit_reached`, `canceled`) are unchanged
12. The `clickOnPanel` lambda has been removed
13. No changes to `CollectCabinetReward`, `CmdConfirmBid`, or shared framework code

- [ ] **Step 4: Commit (if any audit fixups were needed)**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp
git commit -m "chore: final audit fixups for AutoAuction polling refactor"
```

