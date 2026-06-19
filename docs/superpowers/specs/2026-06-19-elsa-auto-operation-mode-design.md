# Elsa Auto Operation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-operation mode toggle to the Elsa Expected Value page that automatically starts the agent, verifies the monitor is running, then runs a placeholder bidding script with a live activity log.

**Architecture:** A new Elsa-specific composable (`useElsaAutoOperation.js`) manages the toggle state, agent ownership, script execution, and activity log. A new `ElsaAutoOperationPanel.vue` renders the UI. `ElsaHeroPanel.vue` stacks the new panel below the existing estimator panel.

**Tech Stack:** Vue 3 Composition API, `useMonitorSwitch`, `useAutoOperationAgentSwitch`, `window.bidkingDesktop.runAutoOperationCommand`

## Global Constraints

- Vue 3 `<script setup>` style throughout — no Options API
- i18n via `useI18n()` / `t()` from `src/shared/i18n.js`; all UI structural labels (titles, button text, status labels, section headers) use i18n keys nested under `tools.hero` in `src/shared/messages.js`. **Activity log message strings are hardcoded and are NOT i18n'd** — they are developer/status output, not UI labels; this is an explicit exception.
- No TypeScript — plain `.js` / `.vue` files
- Follow existing patterns in `src/elsa/` and `src/inject/panels/InjectMetaOperationPanel.vue`
- Do not modify `HeroEstimatorPanelBody.vue` or `useHeroEstimatorPanel.js`
- Log entries capped at 200; when exceeded, drop the oldest
- **Monitor ownership:** The monitor (`useMonitorSwitch`) is a shared singleton. The auto-operation mode treats it as a **prerequisite only** — it checks `monitor.status.value?.running` on enable and fails with a log error if the monitor is not already running. It never calls `startMonitor()`, `toggleMonitor()`, or `stopMonitor()`. This avoids both the options-resolver problem (options are only registered in `monitor/App.vue`) and the ownership problem (shutting down a monitor started elsewhere).
- **Agent ownership:** The agent (`useAutoOperationAgentSwitch`) is also a shared singleton. The composable tracks whether it started the agent via a local `weStartedAgent` flag (reset on disable). On disable, `unloadAgent()` is only called if `weStartedAgent` is true — if the agent was already running before `enable()`, it is left running.
- **Enable success condition:** Both the monitor prerequisite check AND the agent start must succeed. If either fails, `isEnabled` stays false and the script is not started. "Partial success" (monitor OK, agent fails, or vice versa) is not sufficient to enable the mode.
- **Lifecycle cleanup:** The composable registers `onBeforeUnmount` to call `disable()`. It also listens to `window` for `'bidking:leave-tools'` (from `src/shared/tools-page-lifecycle.js`) and calls `disable()` on that event. Both listeners are removed in `onBeforeUnmount`.
- The operation script (`runScript`) is a placeholder in this phase: logs one message and returns; actual bidding logic is out of scope
- `useElsaAutoOperation()` calls `useAutoOperationAgentSwitch()` internally, which uses `onMounted` — the composable must be called inside a component `setup()` context (not at module level)

---

### Task 1: Create `useElsaAutoOperation.js` composable

**Files:**
- Create: `src/elsa/useElsaAutoOperation.js`

**Interfaces:**
- Consumes: `useMonitorSwitch` from `src/shared/useMonitorSwitch.js`, `useAutoOperationAgentSwitch` from `src/shared/useAutoOperationAgentSwitch.js`, `LEAVE_TOOLS_EVENT` from `src/shared/tools-page-lifecycle.js`
- Produces: exported `useElsaAutoOperation()` returning `{ isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log, clearLog }`

- [ ] **Step 1: Write the composable**

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
      // Monitor is a prerequisite — we do not start it; it must already be running.
      if (!monitor.status.value?.running) {
        addLog('Monitor 未运行，请先在 Monitor 页启动监控', 'error');
        return;
      }
      addLog('Monitor 已在运行');

      // Start agent only if not already connected.
      if (!agent.isConnected.value) {
        let agentOk = true;
        await agent.loadAgent().catch(e => {
          agentOk = false;
          addLog(`Agent 启动失败: ${e?.message || e}`, 'error');
        });
        if (!agentOk) return; // agent failed → stay disabled
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
      // Only unload agent if this mode started it; never touch the monitor.
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

- [ ] **Step 2: Verify file is syntactically valid**

Open the file and confirm no obvious syntax errors. No automated test for this task — the composable is tested via the component in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/elsa/useElsaAutoOperation.js
git commit -m "feat(elsa): add useElsaAutoOperation composable skeleton"
```

---

### Task 2: Add i18n keys

**Files:**
- Modify: `src/shared/messages.js`

**Interfaces:**
- Produces: i18n keys used by `ElsaAutoOperationPanel.vue` in Task 3

- [ ] **Step 1: Find the correct nesting path**

Open `src/shared/messages.js` and search for `elsaTitle` to locate where existing Elsa-related keys live. They are nested under `tools.hero` (e.g., `tools.hero.elsaTitle`). All new keys in this task go under the same `tools.hero` object in both locales.

- [ ] **Step 2: Add keys to the Chinese section**

Inside the `tools.hero` object of the `zh` locale, add:

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

- [ ] **Step 3: Add keys to the English section**

Inside the `tools.hero` object of the `en` locale, add:

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

- [ ] **Step 4: Commit**

```bash
git add src/shared/messages.js
git commit -m "feat(elsa): add i18n keys for auto operation panel"
```

---

### Task 3: Create `ElsaAutoOperationPanel.vue`

**Files:**
- Create: `src/elsa/ElsaAutoOperationPanel.vue`

**Interfaces:**
- Consumes: `useElsaAutoOperation` from `./useElsaAutoOperation.js`, `useI18n` from `../shared/i18n.js`
- Produces: self-contained panel component with no props and no emits
- All i18n keys are accessed as `t('tools.hero.elsaAutoOperation*')` — the full dotted path matching Task 2

- [ ] **Step 1: Write the component**

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

- [ ] **Step 2: Commit**

```bash
git add src/elsa/ElsaAutoOperationPanel.vue
git commit -m "feat(elsa): add ElsaAutoOperationPanel component"
```

---

### Task 4: Wire into `ElsaHeroPanel.vue`

**Files:**
- Modify: `src/elsa/ElsaHeroPanel.vue`

**Interfaces:**
- Consumes: `ElsaAutoOperationPanel` from `./ElsaAutoOperationPanel.vue`

- [ ] **Step 1: Read the current file**

Read `src/elsa/ElsaHeroPanel.vue` to see its current content (it is a thin wrapper around `HeroEstimatorPanel` that passes `elsaProfile`).

- [ ] **Step 2: Add the new panel**

Replace the file content with:

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

- [ ] **Step 3: Commit**

```bash
git add src/elsa/ElsaHeroPanel.vue
git commit -m "feat(elsa): mount ElsaAutoOperationPanel on Elsa page"
```

---

### Task 5: Manual smoke test

This task has no code changes. Verify the feature works end-to-end in the running app.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Navigate to the Elsa Expected Value page**

Confirm the "自动操作模式" panel appears below the estimator with correct translated labels (not raw key strings).

- [ ] **Step 3: Test toggle — monitor not running**

With the monitor stopped, click "开启". Verify:
- Log shows "Monitor 未运行，请先在 Monitor 页启动监控" (error level)
- `isEnabled` stays false — button still shows "开启"

- [ ] **Step 4: Test toggle — monitor running, no desktop bridge (browser-only)**

Start the monitor from the Monitor page. Switch to Elsa page and click "开启". Verify:
- Log shows "Monitor 已在运行"
- Log shows "Agent 启动失败: …" (expected — no bridge in browser)
- `isEnabled` stays false — button still shows "开启"

- [ ] **Step 5: Test full enable/disable in Electron**

With Electron running and BidKing process present:
1. Start the monitor from the Monitor page first
2. Open Elsa page → click "开启"
3. Log shows "Monitor 已在运行" then "Agent 已连接" then "自动竞拍脚本已启动"
4. Agent status shows "已连接"; `isEnabled` is true; button shows "关闭"
5. Click "关闭" → log shows "正在停止…" then "已停止"; agent unloads (monitor keeps running)

- [ ] **Step 6: Test ownership — agent already running**

With agent already connected (e.g., started via Inject panel):
1. Click "开启" on Elsa page → log shows "Agent 已在运行" (skips loadAgent, `weStartedAgent` stays false)
2. Click "关闭" → log shows "已停止" but agent is NOT unloaded (still connected)

- [ ] **Step 7: Test LEAVE_TOOLS_EVENT cleanup**

With auto-op mode enabled:
1. Navigate away from Tools (triggers `bidking:leave-tools` event)
2. Verify `disable()` was called — agent unloads if owned, `isEnabled` becomes false
3. Return to Elsa page — button shows "开启"

- [ ] **Step 8: Commit any fixes needed**

```bash
git add -p
git commit -m "fix(elsa): auto operation panel smoke test fixes"
```
