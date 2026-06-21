# Delayed Price Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Inject-page delayed collectible price query that waits `delaySeconds ± jitterSeconds`, can be canceled, and runs through the existing AutoOperation Agent.

**Architecture:** Extend `BKAutoOpAgent.dll` rather than adding a new DLL. The Agent owns one interruptible delayed task at a time and exposes start/status/cancel commands through the existing `\\.\pipe\BKAutoOp` protocol. The renderer uses existing `runAutoOperationCommand` IPC and adds a compact panel in the Inject page.

**Tech Stack:** C++ Win32/IL2CPP Agent, named-pipe JSON protocol, Electron preload/service IPC, Vue 3 Inject UI, Vitest, Vite build.

---

## File Structure

- Modify `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`: add delayed task state, worker thread, and commands.
- Modify `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`: rebuilt Agent artifact.
- Modify `src/inject/App.vue`: add delayed price query panel and state.
- Modify `src/inject/App.test.js`: add UI tests for start/status/cancel command calls.
- Modify `src/shared/messages.js`: add zh/en labels.
- Modify `src/inject/inject.css`: add compact panel styles if needed.
- Modify `docs/AUTO_OPERATION_COMMANDS.md`: document commands.
- Modify `public/inject`: build output from `npm run build:inject`.

## Task 1: Agent Delayed Price Query Commands

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`

- [ ] **Step 1: Add delayed task state**

Add a single-task state struct guarded by a critical section:

```cpp
enum DelayedTaskState {
    DTS_IDLE = 0,
    DTS_SCHEDULED,
    DTS_RUNNING,
    DTS_COMPLETED,
    DTS_CANCELED,
    DTS_FAILED
};

struct DelayedPriceTask {
    char taskId[64];
    int itemCid;
    int delaySeconds;
    int jitterSeconds;
    int actualDelaySeconds;
    DWORD startedTick;
    DWORD dueTick;
    DelayedTaskState state;
    char error[256];
    char result[512];
    HANDLE cancelEvent;
    HANDLE workerThread;
};
```

- [ ] **Step 2: Add `StartDelayedPriceQuery`**

Validate:

```text
itemCid > 0
delaySeconds: 1..86400
jitterSeconds: 0..delaySeconds
no active scheduled/running task
```

Compute:

```text
actualDelaySeconds = delaySeconds - jitterSeconds + rand() % (jitterSeconds * 2 + 1)
```

Create `cancelEvent`, start worker thread, and return current task JSON.

- [ ] **Step 3: Add interruptible worker**

Worker flow:

```text
AttachCurrentThread()
WaitForSingleObject(cancelEvent, actualDelaySeconds * 1000)
if canceled: state=canceled
else state=running
call PlayerManager.GetItemTradeInfo(itemCid)
await Task.Result
parse returned List<T> entries as ExchangeItemTradeInfo price/count tiers
state=completed or failed
PushEventToAll("DelayedPriceQueryUpdated", statusJson)
```

Debug note: field-based `minPrice/tradeCount` parsing was wrong for this path.
`GetItemTradeInfo` completes with `List\`1`; each list entry stores `price` at
object offset `24` and `peopleCount` at offset `28`, matching the older
`BKPayload64::WriteTradeList` parser.

- [ ] **Step 4: Add `GetDelayedPriceQueryStatus` and `CancelDelayedPriceQuery`**

`GetDelayedPriceQueryStatus` returns the current task JSON or `{ "state": "idle" }`.

`CancelDelayedPriceQuery` sets the cancel event when state is `scheduled` or `running`, then returns the current task JSON.

- [ ] **Step 5: Register commands and build**

Add command table entries:

```cpp
{ "StartDelayedPriceQuery",     CmdStartDelayedPriceQuery     },
{ "GetDelayedPriceQueryStatus", CmdGetDelayedPriceQueryStatus },
{ "CancelDelayedPriceQuery",    CmdCancelDelayedPriceQuery    },
```

Run:

```bash
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected: `BKAutoOpAgent.dll` rebuilt successfully.

- [ ] **Step 6: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git commit -m "feat: add delayed price query agent command"
```

## Task 2: Inject UI Panel

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/inject.css`
- Modify: `public/inject`

- [ ] **Step 1: Add failing UI tests**

Add tests that select a collectible, set `delaySeconds=600`, `jitterSeconds=90`, click start, and assert:

```js
expect(window.bidkingDesktop.runAutoOperationCommand).toHaveBeenCalledWith('StartDelayedPriceQuery', {
  itemCid: 1083009,
  delaySeconds: 600,
  jitterSeconds: 90,
});
```

Add cancel test:

```js
expect(window.bidkingDesktop.runAutoOperationCommand).toHaveBeenCalledWith('CancelDelayedPriceQuery', {
  taskId: 'delayed-price-1',
});
```

- [ ] **Step 2: Add UI state and commands**

Add refs for query item, delay, jitter, task result, and loading command. Use existing collectible selector pattern. Implement:

```js
startDelayedPriceQuery()
refreshDelayedPriceQueryStatus()
cancelDelayedPriceQuery()
```

- [ ] **Step 3: Add panel template**

Panel shows:

```text
藏品
基础时间
浮动时间
实际区间
开始
刷新状态
中止
当前任务状态/result JSON
```

- [ ] **Step 4: Add i18n/CSS**

Add zh/en keys under `inject.*`. Keep layout consistent with existing `auto-operation-card` styling.

- [ ] **Step 5: Verify and build**

```bash
npm test -- src/inject/App.test.js
npm run build:inject
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/inject/App.vue src/inject/App.test.js src/shared/messages.js src/inject/inject.css public/inject
git commit -m "feat: add delayed price query panel"
```

## Task 3: Docs and Final Verification

**Files:**
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`

- [ ] **Step 1: Document commands**

Add sections for:

```text
StartDelayedPriceQuery
GetDelayedPriceQueryStatus
CancelDelayedPriceQuery
```

- [ ] **Step 2: Run verification**

```bash
npm test -- src/inject/App.test.js
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
npm run build:inject
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/AUTO_OPERATION_COMMANDS.md
git commit -m "docs: document delayed price query commands"
```

## Self-Review

- Spec coverage: one existing Agent DLL, one delayed task, random delay, cancel command, status command, Inject UI panel, docs.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: command names match across Agent, UI, tests, and docs.
