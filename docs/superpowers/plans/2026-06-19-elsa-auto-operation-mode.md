# Elsa Auto Operation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-operation mode panel to the Elsa Expected Value page: a toggle that verifies the monitor is running, starts the agent, then runs a placeholder bidding script with a live activity log.

**Architecture:** `useElsaAutoOperation.js` owns toggle state, agent lifecycle, script runner, and log. `ElsaAutoOperationPanel.vue` renders the UI with no props. `ElsaHeroPanel.vue` stacks the new panel below the existing estimator. The monitor is treated as a prerequisite (never started or stopped by this feature).

**Tech Stack:** Vue 3 `<script setup>`, Vitest + `@vue/test-utils` + `happy-dom`, `useMonitorSwitch`, `useAutoOperationAgentSwitch`

## Global Constraints

- Vue 3 `<script setup>` throughout — no Options API
- All UI structural labels (titles, buttons, status, headers) use i18n keys under `tools.hero` in `src/shared/messages.js`. Activity log message strings are **hardcoded** — they are status/debug output, not UI labels (explicit exception to the i18n rule)
- No TypeScript — plain `.js` / `.vue`
- Do not modify `HeroEstimatorPanelBody.vue` or `useHeroEstimatorPanel.js`
- Log entries capped at 200; drop oldest when exceeded
- Monitor is a **prerequisite only** — never call `startMonitor`, `toggleMonitor`, or `stopMonitor`; fail gracefully if `monitor.status.value?.running` is false
- Agent ownership: `weStartedAgent` local flag tracks whether this composable called `loadAgent()`. `unloadAgent()` is called on disable **only if** `weStartedAgent` is true
- Enable success condition: monitor must be running AND agent start must succeed; if either fails, `isEnabled` stays false
- Lifecycle cleanup: composable registers `onBeforeUnmount` + `window` listener for `'bidking:leave-tools'` (from `src/shared/tools-page-lifecycle.js`), both calling `disable()` and both removed in `onBeforeUnmount`
- `runScript()` is a placeholder: logs one message and returns immediately
- Test files co-located with source using `/* @vitest-environment happy-dom */`; run with `npx vitest run <file>`

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/elsa/useElsaAutoOperation.js` | Composable — all state, lifecycle, script |
| Create | `src/elsa/useElsaAutoOperation.test.js` | Unit tests for composable logic |
| Create | `src/elsa/ElsaAutoOperationPanel.vue` | UI component — toggle, status grid, log |
| Create | `src/elsa/ElsaAutoOperationPanel.test.js` | Component render + interaction tests |
| Modify | `src/shared/messages.js` | Add 10 i18n keys under `tools.hero` |
| Modify | `src/elsa/ElsaHeroPanel.vue` | Import and mount `ElsaAutoOperationPanel` |
| Modify | `src/elsa/ElsaHeroPanel.test.js` | Assert new panel is rendered |

---

### Task 1: `useElsaAutoOperation.js` composable

**Files:**
- Create: `src/elsa/useElsaAutoOperation.js`
- Create: `src/elsa/useElsaAutoOperation.test.js`

**Interfaces:**
- Consumes: `useMonitorSwitch()` → `{ status: Ref<{running,state}>, stopMonitor }`, `useAutoOperationAgentSwitch()` → `{ isConnected: Ref<bool>, loadAgent, unloadAgent }`, `LEAVE_TOOLS_EVENT = 'bidking:leave-tools'`
- Produces: `useElsaAutoOperation()` → `{ isEnabled: Ref<bool>, isBusy: Ref<bool>, enable: ()=>Promise<void>, disable: ()=>Promise<void>, monitorStatus: ComputedRef<string>, agentConnected: ComputedRef<bool>, log: Ref<Array<{time,level,message}>>, clearLog: ()=>void }`

- [ ] **Step 1: Write the failing tests**

Create `src/elsa/useElsaAutoOperation.test.js`:

```js
/* @vitest-environment happy-dom */
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';

// Mutable monitor/agent state shared across tests
let monitorRunning = false;
let agentConnected = false;
const mockLoadAgent = vi.fn();
const mockUnloadAgent = vi.fn();
const mockStopMonitor = vi.fn();

vi.mock('../shared/useMonitorSwitch.js', () => ({
  useMonitorSwitch: () => ({
    status: { get value() { return { running: monitorRunning, state: monitorRunning ? 'capturing' : 'idle' }; } },
    stopMonitor: mockStopMonitor,
  }),
}));

vi.mock('../shared/useAutoOperationAgentSwitch.js', () => ({
  useAutoOperationAgentSwitch: () => ({
    isConnected: { get value() { return agentConnected; } },
    isBusy: ref(false),
    loadAgent: mockLoadAgent,
    unloadAgent: mockUnloadAgent,
  }),
}));

// Mount a wrapper component so lifecycle hooks work
function withSetup(fn) {
  let result;
  const Wrapper = defineComponent({
    setup() { result = fn(); return {}; },
    template: '<div/>',
  });
  const wrapper = mount(Wrapper, { attachTo: document.body });
  return { result, wrapper };
}

describe('useElsaAutoOperation', () => {
  beforeEach(() => {
    monitorRunning = false;
    agentConnected = false;
    mockLoadAgent.mockResolvedValue(undefined);
    mockUnloadAgent.mockResolvedValue(undefined);
    mockStopMonitor.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts disabled with empty log', () => {
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    expect(result.isEnabled.value).toBe(false);
    expect(result.isBusy.value).toBe(false);
    expect(result.log.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('enable() fails and stays disabled when monitor is not running', async () => {
    monitorRunning = false;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    expect(mockLoadAgent).not.toHaveBeenCalled();
    expect(result.log.value.some(e => e.level === 'error')).toBe(true);
    wrapper.unmount();
  });

  it('enable() fails and stays disabled when agent start fails', async () => {
    monitorRunning = true;
    mockLoadAgent.mockRejectedValue(new Error('no bridge'));
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    expect(result.log.value.some(e => e.level === 'error')).toBe(true);
    wrapper.unmount();
  });

  it('enable() succeeds when monitor running and agent starts', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(true);
    expect(result.log.value.some(e => e.message.includes('已连接'))).toBe(true);
    wrapper.unmount();
  });

  it('disable() unloads agent only when this mode started it', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await result.disable();
    await flushPromises();
    expect(mockUnloadAgent).toHaveBeenCalledTimes(1);
    expect(mockStopMonitor).not.toHaveBeenCalled();
    expect(result.isEnabled.value).toBe(false);
    wrapper.unmount();
  });

  it('disable() does NOT unload agent when agent was already running before enable()', async () => {
    monitorRunning = true;
    agentConnected = true; // already running before enable
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(mockLoadAgent).not.toHaveBeenCalled();
    await result.disable();
    await flushPromises();
    expect(mockUnloadAgent).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('clearLog() empties the log', async () => {
    monitorRunning = false;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable(); // generates a log entry (error)
    await flushPromises();
    expect(result.log.value.length).toBeGreaterThan(0);
    result.clearLog();
    expect(result.log.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('caps log at 200 entries', async () => {
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    // Access internal addLog by triggering enable() 201 times with monitor off
    for (let i = 0; i < 201; i++) {
      await result.enable();
      await flushPromises();
    }
    expect(result.log.value.length).toBeLessThanOrEqual(200);
    wrapper.unmount();
  });

  it('calls disable() when bidking:leave-tools fires', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(true);
    window.dispatchEvent(new CustomEvent('bidking:leave-tools'));
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    wrapper.unmount();
  });

  it('removes event listener on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { wrapper } = withSetup(() => useElsaAutoOperation());
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith('bidking:leave-tools', expect.any(Function));
    removeSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected: all tests fail with "Cannot find module './useElsaAutoOperation.js'"

- [ ] **Step 3: Write the composable**

Create `src/elsa/useElsaAutoOperation.js`:

```js
import { ref, computed, onBeforeUnmount } from 'vue';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';
import { useAutoOperationAgentSwitch } from '../shared/useAutoOperationAgentSwitch.js';
import { LEAVE_TOOLS_EVENT } from '../shared/tools-page-lifecycle.js';

const MAX_LOG = 200;

export function useElsaAutoOperation() {
  const monitor = useMonitorSwitch();
  const agent = useAutoOperationAgentSwitch();

  const isEnabled = ref(false);
  const isBusy = ref(false);
  const log = ref([]);

  let scriptAbort = null;
  let weStartedAgent = false;

  function addLog(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, message };
    if (log.value.length >= MAX_LOG) log.value.shift();
    log.value.push(entry);
  }

  function clearLog() {
    log.value = [];
  }

  async function runScript(/* signal */) {
    addLog('自动竞拍脚本已启动');
    // TODO: bidding logic
  }

  async function enable() {
    if (isEnabled.value || isBusy.value) return;
    isBusy.value = true;
    clearLog();
    try {
      if (!monitor.status.value?.running) {
        addLog('Monitor 未运行，请先在 Monitor 页启动监控', 'error');
        return;
      }
      addLog('Monitor 已在运行');

      if (!agent.isConnected.value) {
        let agentOk = true;
        await agent.loadAgent().catch(e => {
          agentOk = false;
          addLog(`Agent 启动失败: ${e?.message || e}`, 'error');
        });
        if (!agentOk) return;
        weStartedAgent = true;
        addLog('Agent 已连接');
      } else {
        addLog('Agent 已在运行');
      }

      isEnabled.value = true;
      const controller = new AbortController();
      scriptAbort = controller;
      runScript(controller.signal).catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'));
    } finally {
      isBusy.value = false;
    }
  }

  async function disable() {
    if (!isEnabled.value || isBusy.value) return;
    isBusy.value = true;
    if (scriptAbort) { scriptAbort.abort(); scriptAbort = null; }
    try {
      addLog('正在停止…');
      if (weStartedAgent) {
        await agent.unloadAgent().catch(e => addLog(`Agent 卸载失败: ${e?.message || e}`, 'error'));
        weStartedAgent = false;
      }
      addLog('已停止');
      isEnabled.value = false;
    } finally {
      isBusy.value = false;
    }
  }

  function onLeaveTools() {
    if (isEnabled.value) disable();
  }

  window.addEventListener(LEAVE_TOOLS_EVENT, onLeaveTools);

  onBeforeUnmount(() => {
    window.removeEventListener(LEAVE_TOOLS_EVENT, onLeaveTools);
    if (isEnabled.value) disable();
  });

  const monitorStatus = computed(() => monitor.status.value?.state ?? 'idle');
  const agentConnected = computed(() => agent.isConnected.value);

  return { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log, clearLog };
}
```

- [ ] **Step 4: Run tests — confirm they all pass**

```bash
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/elsa/useElsaAutoOperation.js src/elsa/useElsaAutoOperation.test.js
git commit -m "feat(elsa): add useElsaAutoOperation composable with lifecycle cleanup"
```

---

### Task 2: i18n keys + `ElsaAutoOperationPanel.vue`

**Files:**
- Modify: `src/shared/messages.js`
- Create: `src/elsa/ElsaAutoOperationPanel.vue`
- Create: `src/elsa/ElsaAutoOperationPanel.test.js`

**Interfaces:**
- Consumes: `useElsaAutoOperation()` from Task 1 → `{ isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log }`
- Produces: `<ElsaAutoOperationPanel />` — self-contained, no props, no emits

- [ ] **Step 1: Find the i18n nesting path**

Open `src/shared/messages.js` and search for `elsaTitle`. Confirm the key lives under `tools.hero` in both locales. Example: `tools: { hero: { elsaTitle: '…', … } }`. All new keys in this task are added as siblings of `elsaTitle`.

- [ ] **Step 2: Add i18n keys to the Chinese (`zh`) locale**

Inside the `tools.hero` object of the `zh` locale, add these 10 keys as siblings of the existing `elsaTitle` key:

```js
elsaAutoOperationTitle: '自动操作模式',
elsaAutoOperationEnable: '开启',
elsaAutoOperationDisable: '关闭',
elsaAutoOperationBusy: '操作中…',
elsaAutoOperationMonitorLabel: 'Monitor',
elsaAutoOperationAgentLabel: 'Agent',
elsaAutoOperationAgentConnected: '已连接',
elsaAutoOperationAgentDisconnected: '未连接',
elsaAutoOperationLogTitle: '活动日志',
elsaAutoOperationLogEmpty: '暂无日志',
```

- [ ] **Step 3: Add i18n keys to the English (`en`) locale**

Inside the `tools.hero` object of the `en` locale, add the same 10 keys:

```js
elsaAutoOperationTitle: 'Auto Operation Mode',
elsaAutoOperationEnable: 'Enable',
elsaAutoOperationDisable: 'Disable',
elsaAutoOperationBusy: 'Working…',
elsaAutoOperationMonitorLabel: 'Monitor',
elsaAutoOperationAgentLabel: 'Agent',
elsaAutoOperationAgentConnected: 'Connected',
elsaAutoOperationAgentDisconnected: 'Disconnected',
elsaAutoOperationLogTitle: 'Activity Log',
elsaAutoOperationLogEmpty: 'No log entries',
```

- [ ] **Step 4: Write the failing component test**

Create `src/elsa/ElsaAutoOperationPanel.test.js`:

```js
/* @vitest-environment happy-dom */
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import ElsaAutoOperationPanel from './ElsaAutoOperationPanel.vue';

const mockEnable = vi.fn();
const mockDisable = vi.fn();
let isEnabled = ref(false);
let isBusy = ref(false);
let monitorStatus = ref('idle');
let agentConnected = ref(false);
let log = ref([]);

vi.mock('./useElsaAutoOperation.js', () => ({
  useElsaAutoOperation: () => ({
    isEnabled,
    isBusy,
    enable: mockEnable,
    disable: mockDisable,
    monitorStatus,
    agentConnected,
    log,
    clearLog: vi.fn(),
  }),
}));

vi.mock('../shared/i18n.js', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

let mountedWrappers = [];

describe('ElsaAutoOperationPanel', () => {
  beforeEach(() => {
    isEnabled.value = false;
    isBusy.value = false;
    monitorStatus.value = 'idle';
    agentConnected.value = false;
    log.value = [];
  });

  afterEach(() => {
    mountedWrappers.forEach(w => w.unmount());
    mountedWrappers = [];
    vi.clearAllMocks();
  });

  it('renders the panel with testid', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    expect(wrapper.find('[data-testid="elsa-auto-operation-panel"]').exists()).toBe(true);
  });

  it('shows enable button when not enabled', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    const btn = wrapper.find('[data-testid="elsa-auto-operation-toggle"]');
    expect(btn.text()).toBe('tools.hero.elsaAutoOperationEnable');
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('shows disable button when enabled', async () => {
    isEnabled.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    const btn = wrapper.find('[data-testid="elsa-auto-operation-toggle"]');
    expect(btn.text()).toBe('tools.hero.elsaAutoOperationDisable');
  });

  it('shows busy button and disables it when busy', async () => {
    isBusy.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    const btn = wrapper.find('[data-testid="elsa-auto-operation-toggle"]');
    expect(btn.text()).toBe('tools.hero.elsaAutoOperationBusy');
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('calls enable() when toggle clicked while disabled', async () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await wrapper.find('[data-testid="elsa-auto-operation-toggle"]').trigger('click');
    expect(mockEnable).toHaveBeenCalledTimes(1);
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('calls disable() when toggle clicked while enabled', async () => {
    isEnabled.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await wrapper.find('[data-testid="elsa-auto-operation-toggle"]').trigger('click');
    expect(mockDisable).toHaveBeenCalledTimes(1);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('shows empty log message when log is empty', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    expect(wrapper.find('[data-testid="elsa-auto-operation-log"]').text())
      .toContain('tools.hero.elsaAutoOperationLogEmpty');
  });

  it('renders log entries with level class', async () => {
    log.value = [{ time: '12:00:00', level: 'error', message: 'Test error' }];
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    const entry = wrapper.find('[data-testid="elsa-auto-operation-log-entry-0"]');
    expect(entry.exists()).toBe(true);
    expect(entry.classes()).toContain('is-error');
    expect(entry.text()).toContain('Test error');
  });

  it('shows monitor status from composable', async () => {
    monitorStatus.value = 'capturing';
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="elsa-auto-operation-monitor-status"]').text())
      .toContain('capturing');
  });

  it('shows agent connected label when connected', async () => {
    agentConnected.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="elsa-auto-operation-agent-status"]').text())
      .toContain('tools.hero.elsaAutoOperationAgentConnected');
  });
});
```

- [ ] **Step 5: Run tests — confirm they fail**

```bash
npx vitest run src/elsa/ElsaAutoOperationPanel.test.js
```

Expected: all tests fail with "Cannot find module './ElsaAutoOperationPanel.vue'"

- [ ] **Step 6: Write the component**

Create `src/elsa/ElsaAutoOperationPanel.vue`:

```vue
<script setup>
import { ref, watch, nextTick } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';

defineOptions({ name: 'ElsaAutoOperationPanel' });

const { t } = useI18n();
const { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log } =
  useElsaAutoOperation();

const logEl = ref(null);

watch(
  () => log.value.length,
  async () => {
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  },
);

function toggle() {
  if (isBusy.value) return;
  isEnabled.value ? disable() : enable();
}
</script>

<template>
  <section class="listing-advice-panel elsa-auto-operation-panel" data-testid="elsa-auto-operation-panel">
    <header class="section-head elsa-auto-operation-head">
      <h2>{{ t('tools.hero.elsaAutoOperationTitle') }}</h2>
      <button
        class="command-button"
        type="button"
        :disabled="isBusy"
        data-testid="elsa-auto-operation-toggle"
        @click="toggle"
      >
        {{
          isBusy
            ? t('tools.hero.elsaAutoOperationBusy')
            : isEnabled
              ? t('tools.hero.elsaAutoOperationDisable')
              : t('tools.hero.elsaAutoOperationEnable')
        }}
      </button>
    </header>

    <div class="elsa-auto-status-grid">
      <div class="elsa-auto-status-item" data-testid="elsa-auto-operation-monitor-status">
        <span>{{ t('tools.hero.elsaAutoOperationMonitorLabel') }}</span>
        <strong>{{ monitorStatus }}</strong>
      </div>
      <div class="elsa-auto-status-item" data-testid="elsa-auto-operation-agent-status">
        <span>{{ t('tools.hero.elsaAutoOperationAgentLabel') }}</span>
        <strong>{{
          agentConnected
            ? t('tools.hero.elsaAutoOperationAgentConnected')
            : t('tools.hero.elsaAutoOperationAgentDisconnected')
        }}</strong>
      </div>
    </div>

    <h3 class="elsa-auto-operation-log-header">{{ t('tools.hero.elsaAutoOperationLogTitle') }}</h3>
    <div ref="logEl" class="elsa-auto-operation-log" data-testid="elsa-auto-operation-log">
      <p v-if="!log.length" class="status-text is-muted">{{ t('tools.hero.elsaAutoOperationLogEmpty') }}</p>
      <div
        v-for="(entry, i) in log"
        :key="i"
        class="elsa-auto-operation-log-entry"
        :class="`is-${entry.level}`"
        :data-testid="`elsa-auto-operation-log-entry-${i}`"
      >
        <span class="log-time">{{ entry.time }}</span>
        <span class="log-message">{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.elsa-auto-operation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.elsa-auto-status-grid {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.elsa-auto-status-item {
  display: flex;
  gap: 6px;
  font-size: 0.85em;
}

.elsa-auto-operation-log-header {
  margin-top: 12px;
  margin-bottom: 4px;
}

.elsa-auto-operation-log {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 4px;
  padding: 8px;
  font-size: 0.8em;
  font-family: monospace;
}

.elsa-auto-operation-log-entry {
  display: flex;
  gap: 8px;
  line-height: 1.6;
}

.elsa-auto-operation-log-entry.is-error { color: var(--color-error, #c00); }
.elsa-auto-operation-log-entry.is-warn  { color: var(--color-warn, #a60); }

.log-time    { opacity: 0.5; flex-shrink: 0; }
.log-message { word-break: break-all; }
</style>
```

- [ ] **Step 7: Run component tests — confirm they pass**

```bash
npx vitest run src/elsa/ElsaAutoOperationPanel.test.js
```

Expected: all 10 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/messages.js src/elsa/ElsaAutoOperationPanel.vue src/elsa/ElsaAutoOperationPanel.test.js
git commit -m "feat(elsa): add ElsaAutoOperationPanel with i18n keys"
```

---

### Task 3: Wire `ElsaHeroPanel.vue` and update its test

**Files:**
- Modify: `src/elsa/ElsaHeroPanel.vue`
- Modify: `src/elsa/ElsaHeroPanel.test.js`

**Interfaces:**
- Consumes: `ElsaAutoOperationPanel` from `./ElsaAutoOperationPanel.vue` (Task 2)

- [ ] **Step 1: Read the current files**

Read both `src/elsa/ElsaHeroPanel.vue` and `src/elsa/ElsaHeroPanel.test.js` to understand current content before editing.

- [ ] **Step 2: Add a failing assertion to the existing test**

In `src/elsa/ElsaHeroPanel.test.js`, add a mock for `useElsaAutoOperation` and an assertion at the bottom of the existing test:

At the top of the file, add after existing imports:

```js
import ElsaAutoOperationPanel from './ElsaAutoOperationPanel.vue';
```

Add this mock before the `describe` block (alongside the other `vi.mock` / stub setup — or add it right after the `FakeEventSource` class definition):

```js
vi.mock('./useElsaAutoOperation.js', () => ({
  useElsaAutoOperation: () => ({
    isEnabled: { value: false },
    isBusy: { value: false },
    enable: vi.fn(),
    disable: vi.fn(),
    monitorStatus: { value: 'idle' },
    agentConnected: { value: false },
    log: { value: [] },
    clearLog: vi.fn(),
  }),
}));
```

Then inside the existing test `'wraps the shared estimator…'`, add before `wrapper.unmount()` (or before the `mountedWrappers.push` call if there is no explicit unmount):

```js
const autoOpPanel = wrapper.findComponent(ElsaAutoOperationPanel);
expect(autoOpPanel.exists()).toBe(true);
```

- [ ] **Step 3: Run tests — confirm the new assertion fails**

```bash
npx vitest run src/elsa/ElsaHeroPanel.test.js
```

Expected: the existing test fails with "expected false to be true" on the `autoOpPanel.exists()` assertion.

- [ ] **Step 4: Update `ElsaHeroPanel.vue`**

Read `src/elsa/ElsaHeroPanel.vue` — it currently contains:

```vue
<script setup>
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import { elsaProfile } from '../hero-estimator/hero-profiles.js';
</script>

<template>
  <HeroEstimatorPanel :profile="elsaProfile" embedded />
</template>
```

Replace the entire file with:

```vue
<script setup>
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import ElsaAutoOperationPanel from './ElsaAutoOperationPanel.vue';
import { elsaProfile } from '../hero-estimator/hero-profiles.js';
</script>

<template>
  <HeroEstimatorPanel :profile="elsaProfile" embedded />
  <ElsaAutoOperationPanel />
</template>
```

- [ ] **Step 5: Run all Elsa tests — confirm they pass**

```bash
npx vitest run src/elsa/
```

Expected: all tests in `src/elsa/` pass, including the updated `ElsaHeroPanel.test.js`.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests pass with no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/elsa/ElsaHeroPanel.vue src/elsa/ElsaHeroPanel.test.js
git commit -m "feat(elsa): mount ElsaAutoOperationPanel on Elsa page"
```
