# Auto Cabinet Reward Background Scheduler Design

Date: 2026-06-21
Status: Draft for review

## Goal

After `BKAutoOpAgent.dll` is injected, start a native background scheduler by default. Every 3 hours, if the current UI is exactly the main lobby, automatically run the existing cabinet-reward collection flow.

Also add one session-scoped switch in Inject so the user can disable or re-enable this background behavior for the current injection session.

## Current Facts

1. `BKAutoOpAgent` already starts automatically from `DllMain()` by creating `AgentMain()` in `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`.
2. `AgentMain()` already initializes IL2CPP, attaches its worker thread, and starts `HeartbeatThread()`.
3. A manual native command already exists for cabinet reward collection:
   - `CmdCollectCabinetReward(...)` in `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
4. Current cabinet-reward flow is already capable of:
   - converging to a stable cabinet-reward entry screen
   - opening warehouse from `main_lobby`
   - entering the cabinet reward list
   - clicking collect
   - dismissing reward popup / reward list overlays
5. Current screen detection already distinguishes:
   - `main_lobby`
   - `warehouse`
   - `cabinet_reward_list`
   - `cabinet_reward_popup`
6. Inject already has a meta-operation panel at `src/inject/panels/InjectMetaOperationPanel.vue`, and it already exposes manual `CollectCabinetReward`.
7. Current Electron bridge for auto-operation commands is still one-shot request/response. There is no persistent state/event channel that would make live scheduler events visible without polling.

## User Decisions Captured

- implement this in the injected native agent, not in app/electron
- start it automatically after injection
- default state is enabled
- the check interval is 3 hours
- when a check fires and the current UI is not the main lobby, skip the entire cycle
- do not enter a shorter retry loop after a skipped cycle
- provide one switch so the user can disable or re-enable it
- switch state is session-scoped only; it resets on reinjection

## Chosen Approach

Use a dedicated native scheduler thread owned by `BKAutoOpAgent`.

Why this approach:

- it matches the requirement that behavior starts automatically after injection
- it keeps reward automation alive even when no Inject panel is open
- it avoids coupling long-interval scheduling to `HeartbeatThread()`
- it avoids pretending the app side owns a native background feature

## Rejected Alternatives

### 1. Reuse `HeartbeatThread()`

Rejected because heartbeat event emission and cabinet-reward UI automation are separate concerns. Combining them would make the existing event thread responsible for gameplay-side UI mutation.

### 2. Schedule from app/electron

Rejected because it would stop working whenever the app UI is closed or not polling, which contradicts “after injection, default auto-run”.

### 3. Re-dispatch the manual command through the pipe from inside native

Rejected because the background scheduler already lives inside the same DLL and does not need to fake a client/pipe round-trip. The correct reuse point is the reward-collection implementation, not the bridge.

## Design

### 1. Scheduler Lifecycle

Add a dedicated native thread for this feature.

Startup rules:

- `AgentMain()` remains the owner of thread startup
- after `InitIl2cpp()` and the existing worker-thread attach succeed, `AgentMain()` creates one additional thread for cabinet-reward scheduling
- the scheduler thread must also call `g_thread_attach(g_domain)` before any IL2CPP/UI access

Shutdown rules:

- the scheduler thread must observe `g_shuttingDown`
- the scheduler thread must not sleep for the full 3 hours in one blocking `Sleep(...)`
- instead, it tracks a due time and sleeps in short chunks so that:
  - shutdown is responsive
  - enable/disable changes apply promptly

Availability rule:

- if IL2CPP initialization is not ready, the scheduler must not attempt any UI interaction
- for this round, no special bridge redesign is needed; state commands may still report the session toggle state, but actual scheduler work is contingent on `g_il2cppReady`

### 2. Session State Model

The scheduler owns one in-memory, current-session-only state block.

Required state:

- `enabled` — defaults to `true` on each injection
- `running` — whether a background collection cycle is currently executing
- `intervalMs` — fixed at `10800000`
- `nextDueTick` — internal monotonic due time
- `lastCheckAt` — last scheduler wake time that actually evaluated a cycle
- `lastResultCode`
- `lastResultMessage`
- `lastObservedScreen`

Persistence rules:

- none of this state is written to disk
- reinjecting the DLL resets the feature to `enabled = true`, empty history

### 3. Check Timing Semantics

The scheduler does not run immediately on injection.

Rules:

- on thread start, the first due time is `now + 3 hours`
- after each evaluated cycle, the next due time becomes `now + 3 hours`
- if the user disables the feature, no new cycle begins while disabled
- if the user re-enables the feature, the next due time resets to `now + 3 hours`
- disabling while a cycle is already running does not cancel that in-flight cycle; it only prevents future cycles

This keeps the behavior literal to “every 3 hours check once”.

### 4. Cycle Entry Rule

The background scheduler uses a stricter entry condition than the manual command.

At due time:

1. if `enabled == false`, do nothing and keep waiting
2. if `g_shuttingDown != 0`, exit thread
3. if `g_autoAuctionRunning == true`, skip this cycle
4. if another cabinet-reward collection is already running, skip this cycle
5. call `DetectScreenState()`
6. only if `screen == "main_lobby"` may the scheduler proceed with reward collection
7. otherwise skip the cycle and wait for the next 3-hour interval

Important clarification:

- `warehouse` does **not** count as an eligible scheduler entry screen
- overlays on top of lobby do **not** count as `main_lobby`; the scheduler key is the exact detected screen string
- only the manual command keeps its broader “close overlays / recover to entry screen” behavior

This is deliberate. The user requirement is “if current UI is the main lobby, collect reward”, not “from any UI try to navigate to reward collection”.

### 5. Shared Collection Helper

`CmdCollectCabinetReward(...)` must stop owning the reward flow inline.

Refactor the cabinet-reward logic into one reusable native helper, used by:

- manual `CmdCollectCabinetReward(...)`
- background scheduler thread

Required helper behavior:

- preserve the current existing collection flow semantics
- return structured success/failure information to the caller
- centralize the “already running” mutual exclusion

Recommended shape:

```cpp
bool ExecuteCollectCabinetRewardFlow(
    const char* sourceTag,
    std::string* errorMessage
);
```

Design requirements:

- `sourceTag` is only for logging (`"manual"` or `"scheduler"`)
- the helper performs the actual collection flow
- the manual command wraps helper success/failure into `SendResponse(...)`
- the scheduler updates session state and logs based on the same helper result

### 6. Mutual Exclusion Rules

Manual and automatic cabinet-reward collection must not overlap.

Required rules:

- add one native process-local guard for “cabinet reward flow is currently running”
- manual `CollectCabinetReward` must fail fast if the background scheduler already owns the flow
- background scheduler must skip the cycle if a manual collection is already running

Required skip/fail semantics:

- manual command on contention:
  - `ok: false`
  - `error: "collect cabinet reward already running"`
- scheduler on contention:
  - no retry this cycle
  - set `lastResultCode = "skipped_collect_running"`
  - log the skip reason

This round does not require queueing, deferred replay, or cancellation of in-flight reward collection.

### 7. AutoAuction Interaction

Background cabinet-reward checks must not interfere with ongoing Elsa auto-auction.

Rule:

- if `g_autoAuctionRunning` is true when a cabinet-reward cycle becomes due, the scheduler skips the cycle

Skip result:

- `lastResultCode = "skipped_auto_auction_running"`
- `lastResultMessage` explains that auto-auction was active
- next check waits the normal 3-hour interval

This feature does not pause, cancel, or otherwise coordinate with auto-auction beyond “skip this reward cycle”.

### 8. State / Control Commands

Add two lightweight native commands.

#### 8.1 `GetAutoCollectCabinetRewardState`

Args:

```json
{}
```

Success payload:

```json
{
  "enabled": true,
  "running": false,
  "intervalMs": 10800000,
  "nextCheckInMs": 10799000,
  "lastCheckAtUnixMs": 0,
  "lastResultCode": "never_run",
  "lastResultMessage": "",
  "lastObservedScreen": ""
}
```

Contract:

- `nextCheckInMs` is derived from monotonic scheduler state and is clamped to `0` minimum
- if the feature is disabled, return `nextCheckInMs = null`
- `lastCheckAtUnixMs = 0` means no cycle has run yet
- `lastResultCode = "never_run"` means no cycle has run yet

#### 8.2 `SetAutoCollectCabinetRewardEnabled`

Args:

```json
{
  "enabled": false
}
```

Validation:

- `enabled` is required
- invalid or missing value returns:
  - `ok: false`
  - `error: "enabled must be boolean"`

Behavior:

- when setting to `false`:
  - future cycles stop starting
  - current in-flight cycle, if any, is not canceled
- when setting to `true`:
  - `enabled` becomes true
  - `nextDueTick` resets to `now + 3 hours`

Success payload:

- return the same state shape as `GetAutoCollectCabinetRewardState`

### 9. Inject UI Surface

Expose a compact session switch in `src/inject/panels/InjectMetaOperationPanel.vue`.

UI requirements:

- add one dedicated scheduler subsection, separate from the existing manual zero-arg command list
- show:
  - one enable/disable switch
  - one short status line
- the manual `CollectCabinetReward` action remains available and unchanged

State-fetch behavior:

- on panel mount, call `GetAutoCollectCabinetRewardState`
- after toggle changes, call `SetAutoCollectCabinetRewardEnabled`
- after the set command resolves, refresh local UI state from the returned payload

Locking behavior:

- reuse the existing shared `commandLoading` / `emit('command-loading-change', ...)` flow
- toggle actions must participate in the same bridge busy lock as other meta-operation commands

No event stream:

- the panel does not attempt live subscription to scheduler state
- it is acceptable that status text is only refreshed on mount and after explicit toggle actions

### 10. Renderer Copy / i18n

Add dedicated i18n keys for the new Inject panel surface.

At minimum:

- `inject.metaOperationAutoCollectCabinetReward`
- `inject.metaOperationAutoCollectCabinetRewardSub`
- `inject.metaOperationAutoCollectCabinetRewardEnabled`
- `inject.metaOperationAutoCollectCabinetRewardDisabled`
- `inject.metaOperationAutoCollectCabinetRewardStatusNeverRun`
- `inject.metaOperationAutoCollectCabinetRewardStatusRunning`
- `inject.metaOperationAutoCollectCabinetRewardStatusSkippedMainLobby`
- `inject.metaOperationAutoCollectCabinetRewardStatusSkippedAutoAuction`
- `inject.metaOperationAutoCollectCabinetRewardStatusSkippedBusy`
- `inject.metaOperationAutoCollectCabinetRewardStatusSuccess`
- `inject.metaOperationAutoCollectCabinetRewardStatusFailed`

The UI may compress these to one line, but the result-code mapping must be explicit and not inferred ad hoc from English literals.

### 11. Logging

Add native log lines for scheduler lifecycle and each evaluated cycle.

Minimum required lines:

- scheduler thread started
- scheduler disabled by UI
- scheduler enabled by UI
- due-time cycle skipped because screen was not `main_lobby`
- due-time cycle skipped because auto-auction was running
- due-time cycle skipped because cabinet reward flow was already running
- collection success
- collection failure with error text

Recommended examples:

- `AutoCollectCabinetReward scheduler started intervalMs=10800000`
- `AutoCollectCabinetReward skipped: screen=warehouse`
- `AutoCollectCabinetReward skipped: auto auction running`
- `AutoCollectCabinetReward success source=scheduler`
- `AutoCollectCabinetReward failed source=scheduler error=expected warehouse after opening it, got main_lobby`

### 12. Bridge Impact

No Electron timeout special case is required for the new commands.

Reason:

- `GetAutoCollectCabinetRewardState` is instant
- `SetAutoCollectCabinetRewardEnabled` is instant
- the actual long-running reward collection still only happens in:
  - the background thread
  - the existing manual `CollectCabinetReward` command, which already has long-timeout handling in `inject-service.js`

This feature does not require event-channel redesign or timeout policy changes.

## Testing Requirements

### 1. Native Semantics Tests

Extend `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` with pure decision coverage for:

- only `main_lobby` qualifies for scheduler collection
- `warehouse` does not qualify
- skip when auto-auction is running
- skip when cabinet-reward flow is already running

If a tiny new pure helper is needed for this, place it in a test-visible header adjacent to the existing semantics helpers.

### 2. Native Flow / State Tests

Extend or add native tests for:

- state default is `enabled = true`
- enabling resets next due time to 3 hours from “now”
- invalid `enabled` argument is rejected
- manual command and scheduler contention resolve with the documented skip/fail behavior

Pure logic should be tested outside the full pipe runtime wherever possible.

### 3. Inject Panel Tests

Extend `src/inject/panels/InjectMetaOperationPanel.test.js` to cover:

- panel loads scheduler state on mount
- toggling the switch sends `SetAutoCollectCabinetRewardEnabled`
- returned state is rendered back into the panel
- toggle path respects shared command-loading lock

### 4. Verification / Build

At minimum rerun:

- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- any new/updated native scheduler-related tests
- `src/inject/panels/InjectMetaOperationPanel.test.js`
- the native `BKAutoOpAgent` build

### 5. Live Verification

Verify against a real injected game session:

- after injection, default state reports enabled
- before 3 hours elapse, no immediate reward cycle runs
- when due time is reached on `main_lobby`, reward collection runs automatically
- when due time is reached on non-`main_lobby`, the cycle is skipped and retried only after another 3 hours
- disabling in Inject prevents future automatic cycles
- re-enabling starts a fresh 3-hour countdown from the enable moment
- manual `CollectCabinetReward` still works
- manual and automatic collection do not overlap

## Non-Goals

- no persistence across sessions
- no immediate “run now” button for the scheduler
- no retry loop shorter than 3 hours
- no attempt to recover from arbitrary non-lobby UI states
- no bridge event stream for live scheduler telemetry
- no change to existing manual `CollectCabinetReward` user-facing semantics beyond contention handling

## Files Expected To Change

- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- `src/inject/panels/InjectMetaOperationPanel.vue`
- `src/inject/panels/InjectMetaOperationPanel.test.js`
- relevant Inject i18n source files

## Acceptance Criteria

1. Injecting `BKAutoOpAgent.dll` starts a default-enabled, session-scoped cabinet-reward scheduler.
2. The scheduler checks only every 3 hours and does not run immediately on injection.
3. A due-time cycle attempts reward collection only when `DetectScreenState()` is exactly `main_lobby`.
4. Due-time checks on any other screen skip the cycle and wait another full 3 hours.
5. Inject exposes a working session switch that can disable and re-enable the scheduler.
6. Re-enabling resets the next due time to 3 hours from the enable moment.
7. Manual `CollectCabinetReward` remains available.
8. Manual and automatic collection cannot overlap.
9. Auto-auction activity causes the scheduler to skip the cycle instead of interfering.
