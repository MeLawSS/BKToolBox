# Auto Cabinet Reward Background Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start a default-enabled native background scheduler after `BKAutoOpAgent.dll` injection that checks every 3 hours, auto-collects cabinet rewards only from `main_lobby`, and exposes a session-scoped Inject toggle.

**Architecture:** Keep scheduler runtime ownership in native `BKAutoOpAgent`, with the thread entry, command handlers, and shared reward-flow refactor living in `MetaOperations.cpp`, while `BKAutoOpAgent.cpp` only handles thread startup, exported thread-attach helper visibility, and command-table registration. Use one small pure formatting helper header for state JSON / Unix-ms conversion, one small pure semantics helper in `AggregateOperationSemantics.h`, then layer the Inject toggle UI on top of the existing `runAutoOperationCommand(...)` bridge.

**Tech Stack:** C++11 (`BKAutoOpAgent.cpp`, `MetaOperations.cpp`, MinGW via WSL), Vue 3 Composition API, Vitest + happy-dom, PowerShell, git

---

## File Map

| File | Responsibility in this feature |
| --- | --- |
| `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` | Add pure scheduler-entry helper(s) that are easy to test without loading native runtime state |
| `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` | Lock the scheduler screen/busy pure semantics before native runtime edits |
| `tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h` | New pure helper surface for Unix-ms conversion and JSON state serialization, shared by runtime code and native tests |
| `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp` | Lock state JSON / null serialization / Unix-ms conversion before native runtime edits |
| `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h` | Export `AttachCurrentThread()`, declare scheduler thread proc, declare the two new pipe commands |
| `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` | Make `AttachCurrentThread()` visible across translation units, start scheduler thread beside `HeartbeatThread()`, register new commands |
| `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` | Own scheduler runtime state, shared reward-flow helper, contention guard, interruptible waits, state commands, scheduler thread loop |
| `src/inject/panels/InjectMetaOperationPanel.vue` | Add scheduler section, mount-time state fetch, toggle action, and status rendering |
| `src/inject/panels/InjectMetaOperationPanel.test.js` | Lock the new scheduler section UI and shared command lock behavior |
| `src/shared/messages.js` | Add Chinese / English strings for the scheduler section and statuses |
| `docs/superpowers/specs/2026-06-21-auto-cabinet-reward-background-scheduler-design.md` | Approved feature spec; source of truth for runtime behavior |

## Guardrails

- Do not move scheduler ownership into Electron, preload, or renderer code.
- Do not reuse `HeartbeatThread()` as the scheduler.
- Do not create a new preload API; the Inject toggle must use `window.bidkingDesktop.runAutoOperationCommand(...)`.
- Do not keep `ClickNode(..., 1500, ...)` inside reward flow; fixed waits must become shutdown-aware waits.
- Do not export `g_autoAuctionRunning` out of `MetaOperations.cpp`; keep scheduler loop in `MetaOperations.cpp`.
- Do not convert `lastCheckAtUnixMs` from monotonic tick count; it must come from Windows wall clock (`FILETIME` → Unix ms).
- Do not silently change manual `CollectCabinetReward` behavior except for the explicitly specified fail-fast contention case.

## Environment Guard

The worktree currently has no `node_modules/`, and `npm install` has already been observed to fail in this repo under `npm@11` with `Invalid Version:`. JS tasks must not start until dependency install is either already available or that pre-existing environment issue is resolved.

### Task 1: Baseline And Environment Verification

**Files:**
- Read: `package.json`
- Read: `tools/inject/AutoOperation/BKAutoOpAgent/build.sh`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`
- Test: `src/inject/panels/InjectMetaOperationPanel.test.js`

- [ ] **Step 1: Confirm JS dependencies are available in this worktree**

Run:

```powershell
if (!(Test-Path node_modules)) { npm install }
```

Expected:

```text
Either:
1. dependencies install successfully, or
2. npm fails with the already-known repository baseline error `Invalid Version:`
```

If outcome 2 happens, stop here and resolve the environment blocker before starting feature edits. Do not mix missing-dependency failures into feature TDD.

- [ ] **Step 2: Run the native baseline suites before adding tests**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_auto_collect_agg_test && /tmp/bk_auto_collect_agg_test"
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
```

Expected:

```text
Both commands exit 0 before feature tests are added.
```

- [ ] **Step 3: Run the current Inject meta-operation panel suite**

Run:

```bash
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected:

```text
The existing suite passes before the new scheduler UI tests are added.
```

### Task 2: Add Pure Scheduler Semantics Tests First

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Modify later: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`

- [ ] **Step 1: Add failing scheduler-entry semantics assertions**

Append these assertions near the end of `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`, before `return 0;`:

```cpp
    assert(IsEligibleAutoCollectCabinetRewardScreen("main_lobby"));
    assert(!IsEligibleAutoCollectCabinetRewardScreen("warehouse"));
    assert(!IsEligibleAutoCollectCabinetRewardScreen("cabinet_reward_list"));
    assert(!IsEligibleAutoCollectCabinetRewardScreen(""));
    assert(!IsEligibleAutoCollectCabinetRewardScreen(nullptr));

    assert(ShouldSkipAutoCollectCabinetRewardForAutoAuction(true));
    assert(!ShouldSkipAutoCollectCabinetRewardForAutoAuction(false));

    assert(ShouldSkipAutoCollectCabinetRewardForBusyFlow(true));
    assert(!ShouldSkipAutoCollectCabinetRewardForBusyFlow(false));
```

- [ ] **Step 2: Run the aggregate semantics suite and verify RED**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_auto_collect_agg_test && /tmp/bk_auto_collect_agg_test"
```

Expected:

```text
Compilation fails because the three new helper names do not exist yet.
```

- [ ] **Step 3: Implement the minimal pure helpers**

In `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`, add:

```cpp
inline bool IsEligibleAutoCollectCabinetRewardScreen(const char* screen) {
    return screen && strcmp(screen, "main_lobby") == 0;
}

inline bool ShouldSkipAutoCollectCabinetRewardForAutoAuction(bool autoAuctionRunning) {
    return autoAuctionRunning;
}

inline bool ShouldSkipAutoCollectCabinetRewardForBusyFlow(bool rewardFlowRunning) {
    return rewardFlowRunning;
}
```

Place them near the existing cabinet-reward helpers so the scheduler entry rules stay co-located with related UI semantics.

- [ ] **Step 4: Run the aggregate semantics suite and verify GREEN**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_auto_collect_agg_test && /tmp/bk_auto_collect_agg_test"
```

Expected:

```text
The aggregate semantics suite passes with the new scheduler helper coverage.
```

- [ ] **Step 5: Commit the pure scheduler semantics**

Run:

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp
git commit -m "test(native): add cabinet reward scheduler semantics"
```

### Task 3: Add State Formatting And Unix-Time Tests First

**Files:**
- Create: `tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`
- Modify later: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

- [ ] **Step 1: Add failing state-formatting coverage to `MetaOperations.test.cpp`**

At the top of `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`, add the include:

```cpp
#include "AutoCollectCabinetRewardStateFormatting.h"
```

Then append these assertions before `return 0;`:

```cpp
    assert(ConvertWindowsFileTime100nsToUnixMs(116444736000000000ULL) == 0ULL);
    assert(ConvertWindowsFileTime100nsToUnixMs(116444736010000000ULL) == 1000ULL);

    AutoCollectCabinetRewardStateSnapshot disabledState = {};
    disabledState.enabled = false;
    disabledState.running = false;
    disabledState.intervalMs = 10800000;
    disabledState.nextCheckInMs = -1;
    disabledState.lastCheckAtUnixMs = 0;
    disabledState.lastResultCode = "never_run";
    disabledState.lastResultMessage = "";
    disabledState.lastObservedScreen = "";
    assert(
        BuildAutoCollectCabinetRewardStateJson(disabledState) ==
        "{\"enabled\":false,\"running\":false,\"intervalMs\":10800000,\"nextCheckInMs\":null,\"lastCheckAtUnixMs\":0,\"lastResultCode\":\"never_run\",\"lastResultMessage\":\"\",\"lastObservedScreen\":\"\"}"
    );

    AutoCollectCabinetRewardStateSnapshot enabledState = {};
    enabledState.enabled = true;
    enabledState.running = true;
    enabledState.intervalMs = 10800000;
    enabledState.nextCheckInMs = 3210;
    enabledState.lastCheckAtUnixMs = 1710000000123ULL;
    enabledState.lastResultCode = "running";
    enabledState.lastResultMessage = "cycle active";
    enabledState.lastObservedScreen = "main_lobby";
    assert(
        BuildAutoCollectCabinetRewardStateJson(enabledState) ==
        "{\"enabled\":true,\"running\":true,\"intervalMs\":10800000,\"nextCheckInMs\":3210,\"lastCheckAtUnixMs\":1710000000123,\"lastResultCode\":\"running\",\"lastResultMessage\":\"cycle active\",\"lastObservedScreen\":\"main_lobby\"}"
    );
```

- [ ] **Step 2: Run the meta-operations suite and verify RED**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
```

Expected:

```text
Compilation fails because `AutoCollectCabinetRewardStateFormatting.h` and the new helpers do not exist yet.
```

- [ ] **Step 3: Create the minimal pure formatting helper header**

Create `tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h` with:

```cpp
#pragma once

#include <stdint.h>
#include <stdio.h>
#include <string>

struct AutoCollectCabinetRewardStateSnapshot {
    bool enabled = true;
    bool running = false;
    int intervalMs = 10800000;
    int64_t nextCheckInMs = -1;
    uint64_t lastCheckAtUnixMs = 0;
    const char* lastResultCode = "never_run";
    const char* lastResultMessage = "";
    const char* lastObservedScreen = "";
};

inline uint64_t ConvertWindowsFileTime100nsToUnixMs(uint64_t fileTime100ns) {
    const uint64_t kWindowsEpochOffset100ns = 116444736000000000ULL;
    if (fileTime100ns <= kWindowsEpochOffset100ns) return 0ULL;
    return (fileTime100ns - kWindowsEpochOffset100ns) / 10000ULL;
}

inline std::string BuildAutoCollectCabinetRewardStateJson(
    const AutoCollectCabinetRewardStateSnapshot& snapshot
) {
    char buf[1024];
    if (snapshot.nextCheckInMs < 0) {
        snprintf(
            buf,
            sizeof(buf),
            "{\"enabled\":%s,\"running\":%s,\"intervalMs\":%d,\"nextCheckInMs\":null,\"lastCheckAtUnixMs\":%llu,\"lastResultCode\":\"%s\",\"lastResultMessage\":\"%s\",\"lastObservedScreen\":\"%s\"}",
            snapshot.enabled ? "true" : "false",
            snapshot.running ? "true" : "false",
            snapshot.intervalMs,
            (unsigned long long)snapshot.lastCheckAtUnixMs,
            snapshot.lastResultCode ? snapshot.lastResultCode : "",
            snapshot.lastResultMessage ? snapshot.lastResultMessage : "",
            snapshot.lastObservedScreen ? snapshot.lastObservedScreen : ""
        );
    } else {
        snprintf(
            buf,
            sizeof(buf),
            "{\"enabled\":%s,\"running\":%s,\"intervalMs\":%d,\"nextCheckInMs\":%lld,\"lastCheckAtUnixMs\":%llu,\"lastResultCode\":\"%s\",\"lastResultMessage\":\"%s\",\"lastObservedScreen\":\"%s\"}",
            snapshot.enabled ? "true" : "false",
            snapshot.running ? "true" : "false",
            snapshot.intervalMs,
            (long long)snapshot.nextCheckInMs,
            (unsigned long long)snapshot.lastCheckAtUnixMs,
            snapshot.lastResultCode ? snapshot.lastResultCode : "",
            snapshot.lastResultMessage ? snapshot.lastResultMessage : "",
            snapshot.lastObservedScreen ? snapshot.lastObservedScreen : ""
        );
    }
    return std::string(buf);
}
```

- [ ] **Step 4: Run the meta-operations suite and verify GREEN**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
```

Expected:

```text
`MetaOperations.test.cpp` passes with explicit JSON-null and Unix-ms coverage.
```

- [ ] **Step 5: Commit the pure state-formatting helpers**

Run:

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp
git commit -m "test(native): add cabinet reward scheduler state formatting"
```

### Task 4: Add Inject Scheduler UI Tests First

**Files:**
- Modify: `src/inject/panels/InjectMetaOperationPanel.test.js`
- Modify later: `src/inject/panels/InjectMetaOperationPanel.vue`
- Modify later: `src/shared/messages.js`

- [ ] **Step 1: Add a failing mount-time scheduler state test**

Append this case to `src/inject/panels/InjectMetaOperationPanel.test.js`:

```javascript
  it('loads auto collect scheduler state on mount and renders the enabled status', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: true,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: 3600000,
            lastCheckAtUnixMs: 0,
            lastResultCode: 'never_run',
            lastResultMessage: '',
            lastObservedScreen: '',
          },
        }),
    );

    const wrapper = await mountPanel();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetAutoCollectCabinetRewardState', {});
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-toggle"]').element.checked).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-status"]').text()).toContain('未运行');
  });
```

- [ ] **Step 2: Add a failing toggle + shared-lock test**

Append this case immediately after the previous one:

```javascript
  it('toggles the scheduler through the existing command bridge and respects the shared lock', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: true,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: 1000,
            lastCheckAtUnixMs: 0,
            lastResultCode: 'never_run',
            lastResultMessage: '',
            lastObservedScreen: '',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: false,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: null,
            lastCheckAtUnixMs: 1710000000123,
            lastResultCode: 'disabled',
            lastResultMessage: 'disabled by user',
            lastObservedScreen: 'main_lobby',
          },
        }),
    );

    const wrapper = await mountPanel();
    const toggle = wrapper.get('[data-testid="meta-operation-auto-collect-toggle"]');

    await toggle.setValue(false);
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(2, 'SetAutoCollectCabinetRewardEnabled', { enabled: false });
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-status"]').text()).toContain('已关闭');

    wrapper.unmount();
    const lockedWrapper = await mountPanel({ commandLoading: 'CollectCabinetReward' });
    expect(lockedWrapper.get('[data-testid="meta-operation-auto-collect-toggle"]').element.disabled).toBe(true);
  });
```

- [ ] **Step 3: Run the panel suite and verify RED**

Run:

```bash
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected:

```text
The new tests fail because the scheduler section, mount-time fetch, and toggle command do not exist yet.
```

### Task 5: Implement Native Scheduler Runtime And Reward Flow Refactor

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Reference: `tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h`
- Reference: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`

- [ ] **Step 1: Declare the exported attach helper, scheduler thread proc, and new commands**

In `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`, add these declarations:

```cpp
void                AttachCurrentThread();
DWORD WINAPI        AutoCollectCabinetRewardThread(LPVOID);

void CmdGetAutoCollectCabinetRewardState(AgentConn* c, const char* id, const char* json);
void CmdSetAutoCollectCabinetRewardEnabled(AgentConn* c, const char* id, const char* json);
```

Place `AttachCurrentThread()` near the existing BKAutoOpAgent-exported helper declarations, and place the two new command declarations beside the other `Cmd...` declarations at the bottom.

- [ ] **Step 2: Wire the thread start and command-table entries in `BKAutoOpAgent.cpp`**

Make the existing helper non-static and add scheduler startup/registration:

```cpp
static HANDLE        g_autoCollectCabinetRewardThread = NULL;

void AttachCurrentThread() {
    if (g_il2cppReady && g_thread_attach && g_domain)
        g_thread_attach(g_domain);
}
```

In `AgentMain()`, after the existing main-thread attach and beside the heartbeat startup:

```cpp
    AttachCurrentThread();

    g_heartbeatThread = CreateThread(NULL, 0, HeartbeatThread, NULL, 0, NULL);
    g_autoCollectCabinetRewardThread = CreateThread(
        NULL,
        0,
        AutoCollectCabinetRewardThread,
        NULL,
        0,
        NULL
    );
```

In `kCommands`, register:

```cpp
    { "GetAutoCollectCabinetRewardState", CmdGetAutoCollectCabinetRewardState },
    { "SetAutoCollectCabinetRewardEnabled", CmdSetAutoCollectCabinetRewardEnabled },
```

Place them next to the existing cabinet-reward / meta-operation commands.

- [ ] **Step 3: Add scheduler runtime state and shutdown-aware wait helpers**

Near the top of `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`, add the scheduler-owned state:

```cpp
#include "AutoCollectCabinetRewardStateFormatting.h"

static std::atomic<bool> g_autoCollectCabinetRewardEnabled{true};
static std::atomic<bool> g_autoCollectCabinetRewardRunning{false};
static std::atomic<uint64_t> g_autoCollectCabinetRewardNextDueTick{0};

static CRITICAL_SECTION g_autoCollectCabinetRewardStateCs;
static bool g_autoCollectCabinetRewardStateCsReady = false;
static uint64_t g_autoCollectCabinetRewardLastCheckAtUnixMs = 0;
static std::string g_autoCollectCabinetRewardLastResultCode = "never_run";
static std::string g_autoCollectCabinetRewardLastResultMessage;
static std::string g_autoCollectCabinetRewardLastObservedScreen;

static bool IsAgentShuttingDown() {
    return InterlockedCompareExchange(&g_shuttingDown, 0, 0) != 0;
}

static bool SleepForAutoCollectCabinetRewardDelayInterruptibly(int totalMs, int sliceMs = 100) {
    int remaining = totalMs;
    while (remaining > 0) {
        if (IsAgentShuttingDown()) return false;
        const int chunk = remaining < sliceMs ? remaining : sliceMs;
        Sleep((DWORD)chunk);
        remaining -= chunk;
    }
    return !IsAgentShuttingDown();
}
```

Also add a tiny RAII flag guard in the same file so the reward flow cannot leak the running flag across early returns.

- [ ] **Step 4: Refactor manual reward collection into a shared helper**

Replace the current inline `CmdCollectCabinetReward(...)` logic with:

```cpp
static bool ExecuteCollectCabinetRewardFlow(
    const char* sourceTag,
    std::string* errorMessage
) {
    ScopedAutoCollectCabinetRewardRunGuard runGuard(&g_autoCollectCabinetRewardRunning);
    if (!runGuard.acquired()) {
        if (errorMessage) *errorMessage = "collect cabinet reward already running";
        return false;
    }

    ScreenState stable = {};
    for (int attempt = 0; ; attempt++) {
        if (IsAgentShuttingDown()) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }
        ScreenState cur = DetectScreenState();
        if (IsStableCabinetRewardEntryScreen(cur.screen)) {
            stable = cur;
            break;
        }
        if (attempt >= 10) {
            if (errorMessage) *errorMessage = "could not reach cabinet reward entry after 10 close attempts";
            return false;
        }
        Il2CppObject* t = nullptr; const char* p = nullptr;
        if (ResolveCloseTarget(cur, &t, &p)) {
            std::string err;
            ClickNode(t, p, 0, &err);
        }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }
    }

    std::string err;
    if (ShouldOpenWarehouseForCabinetReward(stable.screen)) {
        if (!stable.uiMainTransform) { if (errorMessage) *errorMessage = "UIMain not found"; return false; }
        if (!ClickNode(stable.uiMainTransform, "MainPanel/Btns2/Button_1", 0, &err)) { if (errorMessage) *errorMessage = err; return false; }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) { if (errorMessage) *errorMessage = "shutting down"; return false; }
        stable = DetectScreenState();
        if (strcmp(stable.screen, "warehouse") != 0) {
            if (errorMessage) *errorMessage = std::string("expected warehouse after opening it, got ") + stable.screen;
            return false;
        }
    }

    if (!stable.uiMainTransform) { if (errorMessage) *errorMessage = "UIMain not found"; return false; }
    if (!ClickNode(stable.uiMainTransform, "WareHousePanel/leftDown/Button[0]", 0, &err)) { if (errorMessage) *errorMessage = err; return false; }
    if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) { if (errorMessage) *errorMessage = "shutting down"; return false; }

    ScreenState s3 = DetectScreenState();
    if (strcmp(s3.screen, "cabinet_reward_list") != 0) {
        if (errorMessage) *errorMessage = std::string("expected cabinet_reward_list after 查看, got ") + s3.screen;
        return false;
    }
    if (!s3.collectAwardTransform) { if (errorMessage) *errorMessage = "CollectAward_Main transform missing"; return false; }
    if (!ClickNode(s3.collectAwardTransform, "Panel/down/Button", 0, &err)) { if (errorMessage) *errorMessage = err; return false; }
    if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) { if (errorMessage) *errorMessage = "shutting down"; return false; }

    ScreenState s5 = DetectScreenState();
    if (strcmp(s5.screen, "cabinet_reward_popup") == 0 && s5.rewardsBoxTransform) {
        if (!ClickNode(s5.rewardsBoxTransform, "bg", 0, &err)) { if (errorMessage) *errorMessage = err; return false; }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) { if (errorMessage) *errorMessage = "shutting down"; return false; }
    }

    ScreenState s6 = DetectScreenState();
    if (s6.collectAwardTransform) {
        if (!ClickNode(s6.collectAwardTransform, "bg", 0, &err)) { if (errorMessage) *errorMessage = err; return false; }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) { if (errorMessage) *errorMessage = "shutting down"; return false; }
    }

    Logf("AutoCollectCabinetReward success source=%s", sourceTag ? sourceTag : "unknown");
    return true;
}

void CmdCollectCabinetReward(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    std::string errorMessage;
    if (!ExecuteCollectCabinetRewardFlow("manual", &errorMessage)) {
        SendResponse(c, id, false, errorMessage.empty() ? "collect cabinet reward failed" : errorMessage.c_str());
        return;
    }
    SendResponse(c, id, true, "{\"collected\":true}");
}
```

- [ ] **Step 5: Implement the scheduler commands and thread loop**

In `MetaOperations.cpp`, add:

```cpp
static uint64_t ReadUnixTimeMs() {
    FILETIME fileTime = {};
    GetSystemTimeAsFileTime(&fileTime);
    ULARGE_INTEGER ticks = {};
    ticks.LowPart = fileTime.dwLowDateTime;
    ticks.HighPart = fileTime.dwHighDateTime;
    return ConvertWindowsFileTime100nsToUnixMs(ticks.QuadPart);
}

static AutoCollectCabinetRewardStateSnapshot SnapshotAutoCollectCabinetRewardState() {
    AutoCollectCabinetRewardStateSnapshot snapshot = {};
    snapshot.enabled = g_autoCollectCabinetRewardEnabled.load(std::memory_order_relaxed);
    snapshot.running = g_autoCollectCabinetRewardRunning.load(std::memory_order_relaxed);
    snapshot.intervalMs = 10800000;
    snapshot.nextCheckInMs = snapshot.enabled
        ? (int64_t)std::max<int64_t>(0, (int64_t)g_autoCollectCabinetRewardNextDueTick.load(std::memory_order_relaxed) - (int64_t)GetTickCount64())
        : -1;

    EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
    snapshot.lastCheckAtUnixMs = g_autoCollectCabinetRewardLastCheckAtUnixMs;
    snapshot.lastResultCode = g_autoCollectCabinetRewardLastResultCode.c_str();
    snapshot.lastResultMessage = g_autoCollectCabinetRewardLastResultMessage.c_str();
    snapshot.lastObservedScreen = g_autoCollectCabinetRewardLastObservedScreen.c_str();
    LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);
    return snapshot;
}

void CmdGetAutoCollectCabinetRewardState(AgentConn* c, const char* id, const char*) {
    AutoCollectCabinetRewardStateSnapshot snapshot = SnapshotAutoCollectCabinetRewardState();
    std::string json = BuildAutoCollectCabinetRewardStateJson(snapshot);
    SendResponse(c, id, true, json.c_str());
}

void CmdSetAutoCollectCabinetRewardEnabled(AgentConn* c, const char* id, const char* json) {
    bool enabled = false;
    if (!JsonGetBool(json, "enabled", &enabled)) {
        SendResponse(c, id, false, "enabled must be boolean");
        return;
    }
    g_autoCollectCabinetRewardEnabled.store(enabled, std::memory_order_relaxed);
    if (enabled) {
        g_autoCollectCabinetRewardNextDueTick.store(GetTickCount64() + 10800000ULL, std::memory_order_relaxed);
        Logf("AutoCollectCabinetReward enabled by UI");
    } else {
        Logf("AutoCollectCabinetReward disabled by UI");
    }
    std::string jsonResult = BuildAutoCollectCabinetRewardStateJson(SnapshotAutoCollectCabinetRewardState());
    SendResponse(c, id, true, jsonResult.c_str());
}

DWORD WINAPI AutoCollectCabinetRewardThread(LPVOID) {
    AttachCurrentThread();
    if (!g_autoCollectCabinetRewardStateCsReady) {
        InitializeCriticalSection(&g_autoCollectCabinetRewardStateCs);
        g_autoCollectCabinetRewardStateCsReady = true;
    }

    g_autoCollectCabinetRewardNextDueTick.store(GetTickCount64() + 10800000ULL, std::memory_order_relaxed);
    Logf("AutoCollectCabinetReward scheduler started intervalMs=10800000");

    while (!IsAgentShuttingDown()) {
        const bool enabled = g_autoCollectCabinetRewardEnabled.load(std::memory_order_relaxed);
        const uint64_t nowTick = GetTickCount64();
        const uint64_t dueTick = g_autoCollectCabinetRewardNextDueTick.load(std::memory_order_relaxed);

        if (!enabled) {
            Sleep(250);
            continue;
        }
        if (nowTick < dueTick) {
            Sleep((DWORD)std::min<uint64_t>(250, dueTick - nowTick));
            continue;
        }

        EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
        g_autoCollectCabinetRewardLastCheckAtUnixMs = ReadUnixTimeMs();
        LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);

        if (ShouldSkipAutoCollectCabinetRewardForAutoAuction(g_autoAuctionRunning.load(std::memory_order_relaxed))) {
            EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
            g_autoCollectCabinetRewardLastResultCode = "skipped_auto_auction_running";
            g_autoCollectCabinetRewardLastResultMessage = "auto auction running";
            LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);
            g_autoCollectCabinetRewardNextDueTick.store(GetTickCount64() + 10800000ULL, std::memory_order_relaxed);
            Logf("AutoCollectCabinetReward skipped: auto auction running");
            continue;
        }

        if (ShouldSkipAutoCollectCabinetRewardForBusyFlow(g_autoCollectCabinetRewardRunning.load(std::memory_order_relaxed))) {
            EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
            g_autoCollectCabinetRewardLastResultCode = "skipped_collect_running";
            g_autoCollectCabinetRewardLastResultMessage = "collect cabinet reward already running";
            LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);
            g_autoCollectCabinetRewardNextDueTick.store(GetTickCount64() + 10800000ULL, std::memory_order_relaxed);
            Logf("AutoCollectCabinetReward skipped: collect already running");
            continue;
        }

        ScreenState state = DetectScreenState();
        EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
        g_autoCollectCabinetRewardLastObservedScreen = state.screen;
        LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);

        if (!IsEligibleAutoCollectCabinetRewardScreen(state.screen)) {
            EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
            g_autoCollectCabinetRewardLastResultCode = "skipped_not_main_lobby";
            g_autoCollectCabinetRewardLastResultMessage = state.screen;
            LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);
            g_autoCollectCabinetRewardNextDueTick.store(GetTickCount64() + 10800000ULL, std::memory_order_relaxed);
            Logf("AutoCollectCabinetReward skipped: screen=%s", state.screen);
            continue;
        }

        std::string errorMessage;
        const bool ok = ExecuteCollectCabinetRewardFlow("scheduler", &errorMessage);
        EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
        g_autoCollectCabinetRewardLastResultCode = ok ? "success" : "failed";
        g_autoCollectCabinetRewardLastResultMessage = ok ? "" : errorMessage;
        LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);
        g_autoCollectCabinetRewardNextDueTick.store(GetTickCount64() + 10800000ULL, std::memory_order_relaxed);
        if (!ok) Logf("AutoCollectCabinetReward failed source=scheduler error=%s", errorMessage.c_str());
    }
    return 0;
}
```

- [ ] **Step 6: Run the native suites and build after the runtime implementation**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_auto_collect_agg_test && /tmp/bk_auto_collect_agg_test"
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"
```

Expected:

```text
Both native test executables pass and `BKAutoOpAgent.dll` rebuilds successfully.
```

- [ ] **Step 7: Commit the native scheduler feature**

Run:

```bash
git add \
  tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
  tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h \
  tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp
git commit -m "feat(agent): add cabinet reward background scheduler"
```

### Task 6: Implement The Inject Scheduler Section

**Files:**
- Modify: `src/inject/panels/InjectMetaOperationPanel.vue`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: Add scheduler i18n keys**

In both the Chinese and English sections of `src/shared/messages.js`, add:

```javascript
      metaOperationAutoCollectCabinetReward: '展示柜自动领取',
      metaOperationAutoCollectCabinetRewardSub: '注入后默认每 3 小时检查一次；仅在主界面自动领取。',
      metaOperationAutoCollectCabinetRewardEnabled: '已开启',
      metaOperationAutoCollectCabinetRewardDisabled: '已关闭',
      metaOperationAutoCollectCabinetRewardStatusNeverRun: '未运行',
      metaOperationAutoCollectCabinetRewardStatusRunning: '运行中',
      metaOperationAutoCollectCabinetRewardStatusSkippedMainLobby: '跳过：当前不在主界面',
      metaOperationAutoCollectCabinetRewardStatusSkippedAutoAuction: '跳过：自动竞拍运行中',
      metaOperationAutoCollectCabinetRewardStatusSkippedBusy: '跳过：奖励流程占用中',
      metaOperationAutoCollectCabinetRewardStatusSuccess: '最近一次自动领取成功',
      metaOperationAutoCollectCabinetRewardStatusFailed: '最近一次自动领取失败',
```

and:

```javascript
      metaOperationAutoCollectCabinetReward: 'Auto Collect Cabinet Reward',
      metaOperationAutoCollectCabinetRewardSub: 'Enabled by default after injection. Checks every 3 hours and only auto-collects from the main lobby.',
      metaOperationAutoCollectCabinetRewardEnabled: 'Enabled',
      metaOperationAutoCollectCabinetRewardDisabled: 'Disabled',
      metaOperationAutoCollectCabinetRewardStatusNeverRun: 'Never run',
      metaOperationAutoCollectCabinetRewardStatusRunning: 'Running',
      metaOperationAutoCollectCabinetRewardStatusSkippedMainLobby: 'Skipped: not on main lobby',
      metaOperationAutoCollectCabinetRewardStatusSkippedAutoAuction: 'Skipped: auto auction running',
      metaOperationAutoCollectCabinetRewardStatusSkippedBusy: 'Skipped: reward flow busy',
      metaOperationAutoCollectCabinetRewardStatusSuccess: 'Last automatic collect succeeded',
      metaOperationAutoCollectCabinetRewardStatusFailed: 'Last automatic collect failed',
```

- [ ] **Step 2: Add scheduler state refs and command helpers to the panel script**

In `src/inject/panels/InjectMetaOperationPanel.vue`, add state refs and a mount-time loader:

```javascript
const autoCollectState = ref({
  enabled: true,
  running: false,
  intervalMs: 10800000,
  nextCheckInMs: null,
  lastCheckAtUnixMs: 0,
  lastResultCode: 'never_run',
  lastResultMessage: '',
  lastObservedScreen: '',
});

const autoCollectLoading = ref(false);

const autoCollectStatusText = computed(() => {
  if (autoCollectState.value.running) return t('inject.metaOperationAutoCollectCabinetRewardStatusRunning');
  if (!autoCollectState.value.enabled) return t('inject.metaOperationAutoCollectCabinetRewardDisabled');
  if (autoCollectState.value.lastResultCode === 'skipped_not_main_lobby') return t('inject.metaOperationAutoCollectCabinetRewardStatusSkippedMainLobby');
  if (autoCollectState.value.lastResultCode === 'skipped_auto_auction_running') return t('inject.metaOperationAutoCollectCabinetRewardStatusSkippedAutoAuction');
  if (autoCollectState.value.lastResultCode === 'skipped_collect_running') return t('inject.metaOperationAutoCollectCabinetRewardStatusSkippedBusy');
  if (autoCollectState.value.lastResultCode === 'success') return t('inject.metaOperationAutoCollectCabinetRewardStatusSuccess');
  if (autoCollectState.value.lastResultCode === 'failed') return t('inject.metaOperationAutoCollectCabinetRewardStatusFailed');
  return t('inject.metaOperationAutoCollectCabinetRewardStatusNeverRun');
});

async function loadAutoCollectState() {
  if (!transportReady.value) return;
  const response = await window.bidkingDesktop.runAutoOperationCommand('GetAutoCollectCabinetRewardState', {});
  autoCollectState.value = response?.value || autoCollectState.value;
}

async function toggleAutoCollectEnabled(nextEnabled) {
  if (!canRunMetaOperation.value || autoCollectLoading.value) return;
  autoCollectLoading.value = true;
  localCommandLoading.value = 'SetAutoCollectCabinetRewardEnabled';
  emit('command-loading-change', 'SetAutoCollectCabinetRewardEnabled');
  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(
      'SetAutoCollectCabinetRewardEnabled',
      { enabled: nextEnabled },
    );
    autoCollectState.value = response?.value || autoCollectState.value;
  } catch (error) {
    panelError.value = error?.message || t('inject.failed');
  } finally {
    autoCollectLoading.value = false;
    localCommandLoading.value = '';
    emit('command-loading-change', '');
  }
}

onMounted(() => {
  if (transportReady.value) {
    void loadAutoCollectState().catch(() => {});
  }
});
```

- [ ] **Step 3: Add the scheduler section to the template**

In the template of `src/inject/panels/InjectMetaOperationPanel.vue`, add a new block above the existing zero-arg action list:

```vue
    <section class="meta-operation-scheduler-card" data-testid="meta-operation-auto-collect-card">
      <header class="meta-operation-scheduler-head">
        <div>
          <h3>{{ t('inject.metaOperationAutoCollectCabinetReward') }}</h3>
          <p>{{ t('inject.metaOperationAutoCollectCabinetRewardSub') }}</p>
        </div>
        <label class="meta-operation-scheduler-toggle">
          <input
            data-testid="meta-operation-auto-collect-toggle"
            type="checkbox"
            :checked="autoCollectState.enabled"
            :disabled="!canRunMetaOperation || effectiveCommandLoading"
            @change="toggleAutoCollectEnabled($event.target.checked)"
          >
          <span>
            {{
              autoCollectState.enabled
                ? t('inject.metaOperationAutoCollectCabinetRewardEnabled')
                : t('inject.metaOperationAutoCollectCabinetRewardDisabled')
            }}
          </span>
        </label>
      </header>
      <p data-testid="meta-operation-auto-collect-status" class="status-text">
        {{ autoCollectStatusText }}
      </p>
    </section>
```

- [ ] **Step 4: Run the panel suite and verify GREEN**

Run:

```bash
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected:

```text
The existing panel tests and the two new scheduler tests all pass.
```

- [ ] **Step 5: Commit the Inject scheduler section**

Run:

```bash
git add src/inject/panels/InjectMetaOperationPanel.vue src/inject/panels/InjectMetaOperationPanel.test.js src/shared/messages.js
git commit -m "feat(inject): add cabinet reward scheduler toggle"
```

### Task 7: Final Verification

**Files:**
- Verify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Verify: `tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h`
- Verify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Verify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Verify: `src/inject/panels/InjectMetaOperationPanel.vue`
- Verify: `src/shared/messages.js`

- [ ] **Step 1: Run the touched native and JS suites together**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/bk_auto_collect_agg_test && /tmp/bk_auto_collect_agg_test"
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected:

```text
All targeted native and JS suites pass together.
```

- [ ] **Step 2: Run the native build and Inject page build**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-cabinet-reward-scheduler && bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh"
npm run build:inject
```

Expected:

```text
`BKAutoOpAgent.dll` rebuilds successfully and the Inject bundle builds successfully.
```

- [ ] **Step 3: Run patch-format verification**

Run:

```bash
git diff --check
```

Expected:

```text
No output.
```

- [ ] **Step 4: Create the final integration commit**

Run:

```bash
git add \
  tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h \
  tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/AutoCollectCabinetRewardStateFormatting.h \
  tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h \
  tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp \
  src/inject/panels/InjectMetaOperationPanel.vue \
  src/inject/panels/InjectMetaOperationPanel.test.js \
  src/shared/messages.js
git commit -m "feat: add cabinet reward background scheduler"
```

Expected:

```text
If no follow-up wording fix was needed after the earlier commits, this step may report nothing new to commit. Otherwise it creates the final integration commit.
```

## Spec Coverage Check

- Native scheduler lifecycle, insertion point, and attach-helper export: covered by Task 5.
- Session state model, Unix-ms reporting, and `nextCheckInMs: null` contract: covered by Task 3 and Task 5.
- `main_lobby`-only scheduler entry and skip semantics: covered by Task 2 and Task 5.
- Shared reward-flow helper, contention guard, and interruptible waits: covered by Task 5.
- New pipe commands and dispatch registration: covered by Task 5.
- Inject scheduler toggle, mount-time fetch, and current-session-only UI: covered by Task 4 and Task 6.
- i18n file location and strings: covered by Task 6.
- Native / JS verification and build commands: covered by Task 7.

## Placeholder Scan

- No `TODO`, `TBD`, or “implement later” markers are allowed in execution patches.
- Do not replace the dedicated state serializer with ad hoc `snprintf("%d")` logic that cannot emit JSON `null`.
- Do not skip dispatch-table registration after adding the two new commands.
- Do not leave any `ClickNode(..., 1500, ...)` calls inside the refactored reward flow.

## Type And Naming Consistency

- Use `AttachCurrentThread()` as the exported helper name, matching the existing repository symbol.
- Use `CmdGetAutoCollectCabinetRewardState` and `CmdSetAutoCollectCabinetRewardEnabled` exactly as written in the spec.
- Keep the runtime-only thread proc name `AutoCollectCabinetRewardThread`.
- Keep `lastCheckAtUnixMs`, `nextCheckInMs`, and `lastObservedScreen` spelled exactly the same across native JSON and Vue UI state.
