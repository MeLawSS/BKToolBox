# Elsa Auto Operation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-operation mode toggle to the Elsa Expected Value page that automatically starts the monitor and agent, then runs a placeholder bidding script with a live activity log.

**Architecture:** A new Elsa-specific composable (`useElsaAutoOperation.js`) manages the toggle state, monitor/agent lifecycle, script execution, and activity log. A new `ElsaAutoOperationPanel.vue` renders the UI. `ElsaHeroPanel.vue` stacks the new panel below the existing estimator panel.

**Tech Stack:** Vue 3 Composition API, `useMonitorSwitch`, `useAutoOperationAgentSwitch`, `window.bidkingDesktop.runAutoOperationCommand`

## Global Constraints

- Vue 3 `<script setup>` style throughout — no Options API
- i18n via `useI18n()` / `t()` from `src/shared/i18n.js`; all user-visible strings use i18n keys in `src/shared/messages.js`
- No TypeScript — plain `.js` / `.vue` files
- Follow existing patterns in `src/elsa/` and `src/inject/panels/InjectMetaOperationPanel.vue`
- Do not modify `HeroEstimatorPanelBody.vue` or `useHeroEstimatorPanel.js`
- Log entries capped at 200; when exceeded, drop the oldest
- Monitor start calls `startMonitor()` with no explicit options — relies on the options resolver already registered by `useHeroEstimatorPanel`
- The operation script (`runScript`) is a placeholder in this phase: it logs one message and returns; actual bidding logic is out of scope

---

### Task 1: Create `useElsaAutoOperation.js` composable

**Files:**
- Create: `src/elsa/useElsaAutoOperation.js`

**Interfaces:**
- Consumes: `useMonitorSwitch` from `src/shared/useMonitorSwitch.js`, `useAutoOperationAgentSwitch` from `src/shared/useAutoOperationAgentSwitch.js`
- Produces: exported `useElsaAutoOperation()` returning `{ isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, agentBusy, log, clearLog }`

- [ ] **Step 1: Write the composable**

```js
import { ref, computed } from 'vue';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';
import { useAutoOperationAgentSwitch } from '../shared/useAutoOperationAgentSwitch.js';

const MAX_LOG = 200;

export function useElsaAutoOperation() {
  const monitor = useMonitorSwitch();
  const agent = useAutoOperationAgentSwitch();

  const isEnabled = ref(false);
  const isBusy = ref(false);
  const log = ref([]);

  let scriptAbort = null;

  function addLog(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, message };
    if (log.value.length >= MAX_LOG) log.value.shift();
    log.value.push(entry);
  }

  function clearLog() {
    log.value = [];
  }

  async function runScript(signal) {
    addLog('自动竞拍脚本已启动');
    // TODO: bidding logic
  }

  async function enable() {
    if (isEnabled.value || isBusy.value) return;
    isBusy.value = true;
    clearLog();
    try {
      addLog('正在启动 Monitor 和 Agent…');
      await Promise.all([
        monitor.startMonitor().catch(e => addLog(`Monitor 启动失败: ${e?.message || e}`, 'error')),
        agent.loadAgent().catch(e => addLog(`Agent 启动失败: ${e?.message || e}`, 'error')),
      ]);
      addLog('Monitor 已启动');
      addLog('Agent 已连接');
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
      addLog('正在停止 Monitor 和 Agent…');
      await Promise.all([
        monitor.stopMonitor().catch(e => addLog(`Monitor 停止失败: ${e?.message || e}`, 'error')),
        agent.unloadAgent().catch(e => addLog(`Agent 卸载失败: ${e?.message || e}`, 'error')),
      ]);
      addLog('已停止');
      isEnabled.value = false;
    } finally {
      isBusy.value = false;
    }
  }

  const monitorStatus = computed(() => monitor.status.value?.state ?? 'idle');
  const agentConnected = computed(() => agent.isConnected.value);
  const agentBusy = computed(() => agent.isBusy.value);

  return { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, agentBusy, log, clearLog };
}
```

- [ ] **Step 2: Verify file is syntactically valid**

Open the file and confirm no obvious syntax errors. No automated test for this task — the composable is tested via the component in Task 2.

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

- [ ] **Step 1: Add keys to the Chinese section**

In the `zh` locale object, find the `inject:` key group (or `elsa:` if it exists) and add:

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

- [ ] **Step 2: Add keys to the English section**

In the `en` locale object, add the same keys:

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

> **Note:** Find existing elsa-related i18n keys in `messages.js` (search for `elsa`) to place the new keys in the correct nested path. Use the same nesting path (e.g., if Elsa keys live under `tools.hero`, add under `tools.hero` for both locales). The key short names above are leaf names; adjust the full dotted path to match.

- [ ] **Step 3: Commit**

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

- [ ] **Step 1: Write the component**

```vue
<script setup>
import { ref, watch, nextTick } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';

defineOptions({ name: 'ElsaAutoOperationPanel' });

const { t } = useI18n();
const { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, agentBusy, log } =
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
    <header class="section-head">
      <h2>{{ t('elsa.autoOperationTitle') }}</h2>
      <button
        class="command-button"
        type="button"
        :disabled="isBusy"
        data-testid="elsa-auto-operation-toggle"
        @click="toggle"
      >
        {{
          isBusy
            ? t('elsa.autoOperationBusy')
            : isEnabled
              ? t('elsa.autoOperationDisable')
              : t('elsa.autoOperationEnable')
        }}
      </button>
    </header>

    <div class="meta-operation-status-grid">
      <div class="meta-operation-status-item" data-testid="elsa-auto-operation-monitor-status">
        <span>{{ t('elsa.autoOperationMonitorLabel') }}</span>
        <strong>{{ monitorStatus }}</strong>
      </div>
      <div class="meta-operation-status-item" data-testid="elsa-auto-operation-agent-status">
        <span>{{ t('elsa.autoOperationAgentLabel') }}</span>
        <strong>{{
          agentConnected
            ? t('elsa.autoOperationAgentConnected')
            : t('elsa.autoOperationAgentDisconnected')
        }}</strong>
      </div>
    </div>

    <div class="elsa-auto-operation-log-header">
      <h3>{{ t('elsa.autoOperationLogTitle') }}</h3>
    </div>
    <div ref="logEl" class="elsa-auto-operation-log" data-testid="elsa-auto-operation-log">
      <p v-if="!log.length" class="status-text is-muted">{{ t('elsa.autoOperationLogEmpty') }}</p>
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
.elsa-auto-operation-panel .section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.log-time  { opacity: 0.5; flex-shrink: 0; }
.log-message { word-break: break-all; }

.elsa-auto-operation-log-header {
  margin-top: 12px;
  margin-bottom: 4px;
}
</style>
```

- [ ] **Step 2: Confirm i18n key path**

Open `src/shared/messages.js` and verify that the key path used in `t('elsa.autoOperationTitle')` etc. matches the actual nesting from Task 2. Adjust `t(...)` calls in this component if the nesting path differs.

- [ ] **Step 3: Commit**

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

Read `src/elsa/ElsaHeroPanel.vue` to see its current content (it's a thin wrapper around `HeroEstimatorPanel`).

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

Confirm that the "自动操作模式" panel appears below the estimator.

- [ ] **Step 3: Test toggle — without desktop bridge**

With no Electron desktop bridge available (browser-only), click "开启". Verify:
- The enable() function runs without crashing
- Log entries appear showing monitor/agent start attempts
- Error entries appear (expected — no bridge in browser)
- Toggle button becomes "关闭" after isBusy resolves

- [ ] **Step 4: Test in Electron (if available)**

With Electron running and BidKing process present:
1. Open Elsa page
2. Click "开启" — monitor and agent should start
3. Monitor status should update to "capturing"
4. Agent status should show "已连接"
5. Log should show the startup sequence and "自动竞拍脚本已启动"
6. Click "关闭" — both should stop, log shows "已停止"

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(elsa): auto operation panel smoke test fixes"
```
