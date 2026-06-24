# 柜子奖励改用 Agent 执行 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Inject page cabinet reward tab's dual-button DLL-injection flow with a single agent-driven `CollectCabinetReward` command.

**Architecture:** The panel switches from testing for `queryCabinetReward`/`claimCabinetReward` bridge functions to the shared `useAutoOperationAgentRuntimeState` composable (same pattern as `InjectMetaOperationPanel`). The `CollectCabinetReward` command goes through `runAutoOperationCommand` with the shared `autoOperationCommandLoading` lock in `App.vue`. Old service/main/preload paths are deleted.

**Tech Stack:** Vue 3 (script setup), Vite/Vitest, Node.js (Electron main process)

## Global Constraints

- Worktree: `A:\BidKing-feat-cabinet-reward-via-agent` on branch `feat/cabinet-reward-via-agent`
- Old DLL `BKCabinetRewardPayload64.dll` file stays on disk — only code paths are removed
- `InjectMetaOperationPanel` and its `CollectCabinetReward` button are untouched
- Validation chain: tests → lint → typecheck → build

---

### Task 1: i18n messages update

**Files:**
- Modify: `src/shared/messages.js` — lines 52-57 (zh-CN) and lines 901-906 (en-US)

**Interfaces:**
- Produces: `inject.cabinetRewardSub` (updated text), `inject.claimCabinetReward` (updated text), `inject.claimingCabinetReward` (unchanged), `inject.claimCabinetRewardSuccess` (new)
- Removes: `inject.fetchCabinetReward`, `inject.fetchingCabinetReward`

- [ ] **Step 1: Update zh-CN block (lines 52-57)**

Replace:
```js
      cabinetReward: '展示柜收益',
      cabinetRewardSub: '先请求刷新展示柜数据，再写入 Documents/BidKing/cabinet-reward.json。',
      fetchCabinetReward: '获取当前收益',
      fetchingCabinetReward: '获取中',
      claimCabinetReward: '领取收益',
      claimingCabinetReward: '领取中',
```

With:
```js
      cabinetReward: '展示柜收益',
      cabinetRewardSub: '通过已注入的 Agent 自动导航并领取展示柜收益。',
      claimCabinetReward: '领取柜子奖励',
      claimingCabinetReward: '领取中',
      claimCabinetRewardSuccess: '领取成功',
```

- [ ] **Step 2: Update en-US block (lines 901-906)**

Replace:
```js
      cabinetReward: 'Cabinet Reward',
      cabinetRewardSub: 'Refreshes cabinet data first, then writes Documents/BidKing/cabinet-reward.json.',
      fetchCabinetReward: 'Get Current Reward',
      fetchingCabinetReward: 'Fetching',
      claimCabinetReward: 'Claim Reward',
      claimingCabinetReward: 'Claiming',
```

With:
```js
      cabinetReward: 'Cabinet Reward',
      cabinetRewardSub: 'Auto-navigates and claims cabinet reward via the injected agent.',
      claimCabinetReward: 'Claim Cabinet Reward',
      claimingCabinetReward: 'Claiming',
      claimCabinetRewardSuccess: 'Reward claimed',
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/messages.js
git commit -m "i18n: update cabinet reward keys for agent-driven flow"
```

---

### Task 2: Panel rewrite

**Files:**
- Modify: `src/inject/panels/InjectCabinetRewardPanel.vue` — entire file (120 lines → ~95 lines)

**Interfaces:**
- Consumes: `useAutoOperationAgentRuntimeState` from `../../shared/useAutoOperationAgentSwitch.js` (returns `{ isAvailable, isConnected, errorText, isBusy, statusText }` — all `ComputedRef<boolean>` or `ComputedRef<string>`)
- Consumes from i18n: `inject.cabinetReward`, `inject.cabinetRewardSub`, `inject.claimCabinetReward`, `inject.claimingCabinetReward`, `inject.claimCabinetRewardSuccess`, `inject.failed`, `inject.unavailable`, `inject.metaOperationTransportHint`, `inject.controllerAgentDisconnectedHint`, `inject.controllerBusyHint`, `inject.metaOperationReadyHint`
- Consumes: `window.bidkingDesktop.runAutoOperationCommand(command, args)` → `Promise<{ok, value, error}>`
- Produces: `commandLoading` prop (String, default `''`), `command-loading-change` emit (payload: String)

- [ ] **Step 1: Replace entire file**

Write `src/inject/panels/InjectCabinetRewardPanel.vue`:

```vue
<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectCabinetRewardPanel' });

const props = defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const localLoading = ref(false);
const errorMessage = ref('');
const successText = ref('');

const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const agentBridgeAvailable = computed(() => agent.isAvailable.value);
const agentConnected = computed(() => agent.isConnected.value);
const runAutoOperationCommandAvailable = computed(
  () => typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
);
const effectiveCommandLoading = computed(() => props.commandLoading || localLoading.value);

const transportReady = computed(() =>
  Boolean(
    desktopReady.value &&
    agentBridgeAvailable.value &&
    agentConnected.value &&
    runAutoOperationCommandAvailable.value,
  ),
);

const canRunCollect = computed(() =>
  Boolean(transportReady.value && !effectiveCommandLoading.value),
);

const transportHintText = computed(() => {
  if (!desktopReady.value) return t('inject.unavailable');
  if (!agentBridgeAvailable.value || !runAutoOperationCommandAvailable.value) {
    return t('inject.metaOperationTransportHint');
  }
  if (!agentConnected.value) return t('inject.controllerAgentDisconnectedHint');
  if (effectiveCommandLoading.value) return t('inject.controllerBusyHint');
  return t('inject.metaOperationReadyHint');
});

async function collectCabinetReward() {
  if (!canRunCollect.value) return;

  errorMessage.value = '';
  successText.value = '';
  localLoading.value = true;
  emit('command-loading-change', 'CollectCabinetReward');

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(
      'CollectCabinetReward',
      {},
    );
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    successText.value = t('inject.claimCabinetRewardSuccess');
  } catch (error) {
    errorMessage.value = error?.message || t('inject.failed');
  } finally {
    localLoading.value = false;
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <header class="section-head">
    <div>
      <h2>{{ t('inject.cabinetReward') }}</h2>
      <p>{{ t('inject.cabinetRewardSub') }}</p>
    </div>
    <div class="action-row">
      <button
        class="primary-button"
        type="button"
        data-testid="cabinet-claim-button"
        :disabled="!canRunCollect"
        @click="collectCabinetReward"
      >
        {{ effectiveCommandLoading ? t('inject.claimingCabinetReward') : t('inject.claimCabinetReward') }}
      </button>
    </div>
  </header>

  <p v-if="!transportReady" class="status-text is-muted">
    {{ transportHintText }}
  </p>
  <p v-else-if="errorMessage" class="status-text is-error">
    {{ errorMessage }}
  </p>
  <p v-else-if="successText" class="status-text">
    {{ successText }}
  </p>
</template>
```

- [ ] **Step 2: Verify no syntax errors**

```bash
npx vite build --config src/inject/vite.config.js 2>&1 | tail -5
```

This should produce a build error if there's a syntax issue. We only check for parse errors here — full build validation is Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/inject/panels/InjectCabinetRewardPanel.vue
git commit -m "feat: rewrite cabinet reward panel to use agent CollectCabinetReward"
```

---

### Task 3: App.vue shared-lock wiring

**Files:**
- Modify: `src/inject/App.vue` — line 140

**Interfaces:**
- Consumes: `InjectCabinetRewardPanel` now expects `commandLoading` prop (String) and emits `command-loading-change` (String)
- Wires into: `autoOperationCommandLoading` ref and `setAutoOperationCommandLoading` function (same lock used by AgentPanel, ControllerPanel, MetaOperationPanel)

- [ ] **Step 1: Replace the cabinet panel mount line**

Replace:
```html
          <InjectCabinetRewardPanel />
```

With:
```html
          <InjectCabinetRewardPanel
            :command-loading="autoOperationCommandLoading"
            @command-loading-change="setAutoOperationCommandLoading"
          />
```

- [ ] **Step 2: Verify** — the `autoOperationCommandLoading` ref and `setAutoOperationCommandLoading` function are already defined in App.vue (lines ~18 and `defineExpose` block ~line 120). No new declarations needed.

- [ ] **Step 3: Commit**

```bash
git add src/inject/App.vue
git commit -m "feat: wire cabinet reward panel into shared command-loading lock"
```

---

### Task 4: inject-service.js cleanup

**Files:**
- Modify: `electron/services/inject-service.js`

**Interfaces:**
- Removes: `getCabinetRewardPath` (function + export), `runCabinetRewardCommand` (function), `queryCabinetReward` (function + export), `claimCabinetReward` (function + export)

- [ ] **Step 1: Delete `getCabinetRewardPath` function (lines 25-27)**

Delete:
```js
function getCabinetRewardPath(documentsDir) {
    return path.join(documentsDir, 'BidKing', 'cabinet-reward.json');
}
```

And the blank line that follows it (line 28).

- [ ] **Step 2: Delete `runCabinetRewardCommand` function**

Search for `async function runCabinetRewardCommand` and delete the entire function through its closing `}`. The function block is 24 lines:

```js
async function runCabinetRewardCommand(command, deps = {}) {
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (!documentsDir) {
        throw new Error('Documents directory is not available.');
    }

    const outputPath = getCabinetRewardPath(documentsDir);
    const startedAt = Date.now();
    await runInjector(command, {
        ...deps,
        dllPath: deps.dllPath || getRuntimePath('tools', 'inject', 'BKCabinetRewardPayload64', 'BKCabinetRewardPayload64.dll'),
    });
    const value = await waitForJsonFile(outputPath, startedAt, {
        timeoutMs: deps.timeoutMs ?? 45000,
        pollIntervalMs: deps.pollIntervalMs,
    });
    const ok = value?.ok !== false;
    return {
        ok,
        error: ok ? undefined : value?.error,
        path: outputPath,
        value,
    };
}
```

- [ ] **Step 3: Delete `queryCabinetReward` and `claimCabinetReward` wrappers**

Delete:
```js
async function queryCabinetReward(deps = {}) {
    return runCabinetRewardCommand('CabinetReward', deps);
}

async function claimCabinetReward(deps = {}) {
    return runCabinetRewardCommand('ClaimCabinetReward', deps);
}
```

- [ ] **Step 4: Trim `module.exports`**

Remove these entries from the exports object:
```
    claimCabinetReward,
    getCabinetRewardPath,
    queryCabinetReward,
```

- [ ] **Step 5: Commit**

```bash
git add electron/services/inject-service.js
git commit -m "refactor: remove legacy cabinet reward service functions"
```

---

### Task 5: main.js IPC cleanup

**Files:**
- Modify: `electron/main.js` — lines 7, 10, 595-608

- [ ] **Step 1: Remove import destructuring entries**

In the destructured require (lines 5-15), remove `claimCabinetReward,` from line 7 and `queryCabinetReward,` from line 10.

- [ ] **Step 2: Remove IPC handlers (lines 595-608)**

Delete:
```js
    ipcMain.handle('inject:queryCabinetReward', async () => {
        try {
            return await queryCabinetReward();
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:claimCabinetReward', async () => {
        try {
            return await claimCabinetReward();
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
```

- [ ] **Step 3: Commit**

```bash
git add electron/main.js
git commit -m "refactor: remove legacy cabinet reward IPC handlers"
```

---

### Task 6: preload.js bridge cleanup

**Files:**
- Modify: `electron/preload.js` — lines 14, 20

- [ ] **Step 1: Delete `queryCabinetReward` bridge (line 14)**

Delete:
```js
    queryCabinetReward: () => ipcRenderer.invoke('inject:queryCabinetReward'),
```

- [ ] **Step 2: Delete `claimCabinetReward` bridge (line 20)**

Delete:
```js
    claimCabinetReward: () => ipcRenderer.invoke('inject:claimCabinetReward'),
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "refactor: remove legacy cabinet reward bridge from preload"
```

---

### Task 7: inject-service.test.mjs cleanup

**Files:**
- Modify: `electron/services/inject-service.test.mjs` — delete lines 31-110

**Interfaces:**
- Removes: `describe('inject-service cabinet reward', ...)` block (two tests covering `queryCabinetReward` and `claimCabinetReward`)
- Preserves: `describe('inject-service AutoOperation Agent', ...)` block (starts at line 112), including the `runAutoOperationCommand('CollectCabinetReward')` timeout test at line 438

- [ ] **Step 1: Delete the cabinet reward test block**

Delete lines 31-110 — the entire `describe('inject-service cabinet reward', () => { ... })` block including both inner `it(...)` tests.

The block starts at line 31 (`describe('inject-service cabinet reward', () => {`) and ends at line 110 (`});`).

Verify after deletion: the next block starting at line 112 (`describe('inject-service AutoOperation Agent', () => {`) becomes the immediate successor with no orphaned code.

- [ ] **Step 2: Commit**

```bash
git add electron/services/inject-service.test.mjs
git commit -m "test: remove legacy cabinet reward service tests"
```

---

### Task 8: App.test.js rewrite

**Files:**
- Modify: `src/inject/App.test.js`

**Interfaces:**
- Replaces 3 cabinet-specific tests with 3 agent-driven equivalents
- Removes `queryCabinetReward`, `claimCabinetReward` from 13 other mock setups (two-line deletions each)
- All removed mock properties were on `window.bidkingDesktop` objects in `beforeEach`/test-local scope

**Test file mapping — three cabinet tests to rewrite:**

| Old test (line) | New test |
|---|---|
| 46–70: "shows a cabinet reward button and renders the value returned by the desktop API" | "invokes CollectCabinetReward and displays success text" |
| 72–96: "shows a claim button and refreshes the displayed reward after claiming" | "displays error when CollectCabinetReward fails" |
| 703–712: "disables cabinet actions when the desktop claim API is unavailable" | "disables cabinet claim button when agent transport is unavailable" |

- [ ] **Step 1: Rewrite first cabinet test (replace lines 46-70)**

```js
  it('invokes CollectCabinetReward and displays success text', async () => {
    window.sessionStorage.setItem('bidking-auto-operation-agent-connected', 'true');
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { collected: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await nextTick();

    const button = wrapper.find('[data-testid="cabinet-claim-button"]');
    expect(button.exists()).toBe(true);

    await button.trigger('click');
    expect(runAutoOperationCommand).toHaveBeenCalledWith('CollectCabinetReward', {});

    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('领取成功');
  });
```

- [ ] **Step 2: Rewrite second cabinet test (replace lines 72-96)**

```js
  it('displays error when CollectCabinetReward fails', async () => {
    window.sessionStorage.setItem('bidking-auto-operation-agent-connected', 'true');
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: false,
      error: 'cabinet is empty',
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await nextTick();

    const button = wrapper.find('[data-testid="cabinet-claim-button"]');
    await button.trigger('click');

    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('cabinet is empty');
  });
```

- [ ] **Step 3: Rewrite third cabinet test (replace lines 703-712)**

```js
  it('disables cabinet claim button when agent transport is unavailable', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
    };

    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="cabinet-claim-button"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('当前环境不支持');
  });
```

The text match `'当前环境不支持'` comes from `inject.metaOperationTransportHint` (zh-CN default locale), which is the hint shown when `agentBridgeAvailable` is false.

- [ ] **Step 4: Remove `queryCabinetReward`/`claimCabinetReward` from all remaining mock setups**

In each of the following line pairs, delete both lines from the `window.bidkingDesktop = { ... }` object:

| Line pair | Context (which test) |
|---|---|
| 109-110 | "starts the AutoOperation Agent and renders the ping result" |
| 139-140 | "detects the agent pipe offline via Ping" |
| 235-236 | "injects the AutoOperation Agent and unloads it on UnloadAgent" |
| 284-285 | "executes OpenPanel via the agent" |
| 326-327 | "executes InvokeMethod via the agent" |
| 363-364 | "delegates lifecycle events through the agent bridge" |
| 415-416 | "renders warehouse items from agent bridge" |
| 440-441 | "displays a warehouse item count and loads individual items on click" |
| 496-497 | "renders delayed price state from the agent bridge" |
| 527-528 | "renders stock move controls from agent bridge" |
| 587-588 | "queries the collection scan agent state" |
| 631-632 | "starts and stops collection price scan" |
| 678-679 | "shows collection scan state via event bus" |

For each pair, the two lines to delete are:
```js
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
```

- [ ] **Step 5: Commit**

```bash
git add src/inject/App.test.js
git commit -m "test: rewrite cabinet tests for agent-driven flow, remove old API stubs"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run scoped tests for affected modules**

```bash
npx vitest run src/inject/App.test.js electron/services/inject-service.test.mjs 2>&1
```

Expected: all tests pass (24 + 27 = 51 tests, zero failures).

Optional full suite: `npm test` — 14 pre-existing failures are expected. 13 are in unrelated areas (Ethan, server, scripts, controllerUiNodeLabels). The 14th is `inject-service.test.mjs:277` (UnloadAgent pipe-wait test) which intermittently times out under full-suite load; it is not caused by this feature.

- [ ] **Step 2: Run build for inject page**

```bash
npm run build:inject 2>&1
```

Expected: Vite build succeeds.

- [ ] **Step 3: Verify no remaining references to deleted symbols**

```bash
grep -rn 'queryCabinetReward\|claimCabinetReward\|runCabinetRewardCommand\|getCabinetRewardPath' src/ electron/ --include='*.js' --include='*.vue' --include='*.mjs' 2>&1
```

Expected: no output (zero remaining references in source code). Legitimate hits in `messages.js` (i18n keys `claimCabinetReward` / `claimCabinetRewardSuccess`) and spec/plan docs are expected.

Note: The project has no `eslint` or `vue-tsc` configured — lint and typecheck steps are skipped.

- [ ] **Step 4: Commit if any fixes were made, or confirm clean**

```bash
git status
```
