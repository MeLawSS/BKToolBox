# TopBar Monitor / Agent Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Monitor switch` 从 Ethan 页内入口提升为 `TopBar` 常驻入口，并新增桌面端专属的 `Agent switch`，用于 load/unload `BKAutoOpAgent.dll`，同时让 Ethan、Elsa、`/Monitor`、`/Inject` 共享同一份 monitor / agent 运行时状态。

**Architecture:** 新增两个 `src/shared` 共享 composable，分别持有 monitor 运行时和 AutoOperation Agent 运行时的模块级单例状态；`TopBar.vue` 只负责渲染常驻开关；Hero Estimator、`/Monitor`、`/Inject` 改为消费共享 runtime，不再各自拥有独立 monitor/agent 生命周期逻辑。共享 monitor composable 同时统一 `/api/bidking-monitor/events` 连接，避免重复 SSE。

**Tech Stack:** Vue 3 `<script setup>` + `ref/computed/onMounted/onBeforeUnmount`，Vite，`fetch` + `EventSource`，Electron preload bridge (`window.bidkingDesktop`)，Vitest + `@vue/test-utils` + `happy-dom`。

参考设计：`docs/superpowers/specs/2026-06-03-topbar-monitor-agent-switch-design.md`

---

## File Structure

- **Create** `src/shared/useMonitorSwitch.js` — monitor 共享运行时：状态拉取、start/stop/toggle、共享 SSE、事件订阅、并发保护。
- **Create** `src/shared/useMonitorSwitch.test.js` — monitor 共享运行时单测。
- **Create** `src/shared/useAutoOperationAgentSwitch.js` — Agent 共享运行时：桌面能力检测、初始 `Ping`、load/unload、并发保护。
- **Create** `src/shared/useAutoOperationAgentSwitch.test.js` — Agent 共享运行时单测。
- **Create** `src/shared/topbar-controls.css` — 顶栏 monitor / agent 开关的共享样式。
- **Modify** `src/shared/TopBar.vue` — 接入共享 composable，渲染两个常驻开关，并导入共享样式。
- **Modify** `src/shared/TopBar.test.js` — 顶栏运行时开关的可见性与交互测试。
- **Modify** `src/shared/messages.js` — 增加顶栏 `Monitor` / `Agent` 文案。
- **Modify** `src/hero-estimator/HeroEstimatorPanelBody.vue` — 删除 Ethan 页局部 header monitor switch。
- **Modify** `src/hero-estimator/useHeroEstimatorPanel.js` — 改为消费共享 monitor runtime，保留英雄专属事件解释逻辑。
- **Modify** `src/hero-estimator/HeroEstimatorPanel.test.js` — 删除旧开关后的英雄页回归测试。
- **Modify** `src/monitor/App.vue` — 改为消费共享 monitor runtime，保留现有高级配置表单。
- **Modify** `src/monitor/App.test.js` — `/Monitor` 页面共享 runtime 回归测试。
- **Modify** `src/inject/App.vue` — 改为消费共享 Agent runtime 的主要状态与 load/unload 行为。
- **Modify** `src/inject/App.test.js` — `/Inject` 页面共享 runtime 回归测试。
- **Modify** `docs/Documentation.md` — 记录顶栏 monitor / agent 开关当前行为与验证命令。

---

## Task 1: Shared Monitor Runtime

**Files:**
- Create: `src/shared/useMonitorSwitch.js`
- Test: `src/shared/useMonitorSwitch.test.js`

- [ ] **Step 1: 写失败测试，固定 monitor 共享 runtime 的接口和单例行为**

创建 `src/shared/useMonitorSwitch.test.js`：

```js
/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMonitorSwitchRuntimeForTest,
  useMonitorSwitch,
} from './useMonitorSwitch.js';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.close = vi.fn();
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, payload) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }
}

FakeEventSource.instances = [];

describe('useMonitorSwitch', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    __resetMonitorSwitchRuntimeForTest();
    vi.unstubAllGlobals();
  });

  it('shares one status fetch and one event source across consumers', async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url) === '/api/bidking-monitor/status') {
        return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    const a = useMonitorSwitch();
    const b = useMonitorSwitch();
    await Promise.all([a.refreshStatus(), b.refreshStatus()]);
    a.ensureStreamConnected();
    b.ensureStreamConnected();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('starts with custom payload and stops through shared actions', async () => {
    const fetch = vi.fn(async (url, options) => {
      if (String(url) === '/api/bidking-monitor/status') {
        return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
      }
      if (String(url) === '/api/bidking-monitor/start') {
        expect(JSON.parse(options.body)).toMatchObject({ remoteAddress: '127.0.0.1', port: 10000 });
        return { ok: true, json: async () => ({ state: 'capturing', running: true, totalEvents: 0, lastError: null }) };
      }
      if (String(url) === '/api/bidking-monitor/stop') {
        return { ok: true, json: async () => ({ state: 'stopped', running: false, totalEvents: 0, lastError: null }) };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    const monitor = useMonitorSwitch();
    await monitor.startMonitor({ remoteAddress: '127.0.0.1', port: 10000 });
    expect(monitor.status.value.running).toBe(true);
    await monitor.stopMonitor();
    expect(monitor.status.value.running).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/useMonitorSwitch.test.js`

Expected: FAIL，提示找不到 `./useMonitorSwitch.js` 或导出缺失。

- [ ] **Step 3: 写最小实现，建立共享 monitor runtime**

创建 `src/shared/useMonitorSwitch.js`：

```js
import { computed, ref } from 'vue';
import { useI18n } from './i18n.js';

const defaultStatus = () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null });
const status = ref(defaultStatus());
const errorText = ref('');
const isBusy = ref(false);
const listeners = new Set();

let eventSource = null;
let refreshPromise = null;
let startPromise = null;
let stopPromise = null;

function parsePayload(message) {
  try {
    return JSON.parse(message?.data ?? 'null');
  } catch (_error) {
    return null;
  }
}

function notify(payload) {
  for (const listener of listeners) listener(payload);
}

async function refreshStatus() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const response = await fetch('/api/bidking-monitor/status');
    if (!response.ok) throw new Error(await response.text());
    status.value = await response.json();
    return status.value;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function startMonitor(options = {}) {
  if (startPromise) return startPromise;
  errorText.value = '';
  isBusy.value = true;
  startPromise = (async () => {
    const response = await fetch('/api/bidking-monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || response.statusText);
    }
    status.value = await response.json();
    return status.value;
  })()
    .catch((error) => {
      errorText.value = error?.message || String(error);
      throw error;
    })
    .finally(() => {
      isBusy.value = false;
      startPromise = null;
    });
  return startPromise;
}

async function stopMonitor() {
  if (stopPromise) return stopPromise;
  errorText.value = '';
  isBusy.value = true;
  stopPromise = (async () => {
    const response = await fetch('/api/bidking-monitor/stop', { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());
    status.value = await response.json();
    return status.value;
  })()
    .catch((error) => {
      errorText.value = error?.message || String(error);
      throw error;
    })
    .finally(() => {
      isBusy.value = false;
      stopPromise = null;
    });
  return stopPromise;
}

function ensureStreamConnected() {
  if (eventSource || typeof EventSource !== 'function') return eventSource;
  eventSource = new EventSource('/api/bidking-monitor/events');
  eventSource.addEventListener('status', (message) => {
    const payload = parsePayload(message);
    if (!payload) return;
    status.value = Object.assign({}, status.value, payload);
    notify({ kind: 'status', payload });
  });
  eventSource.addEventListener('error', (message) => {
    const payload = parsePayload(message);
    if (!payload) return;
    status.value = Object.assign({}, status.value, payload);
    notify({ kind: 'error', payload });
  });
  eventSource.addEventListener('event', (message) => {
    const payload = parsePayload(message);
    if (payload) notify({ kind: 'event', payload });
  });
  return eventSource;
}

export function useMonitorSwitch() {
  const { t } = useI18n();
  return {
    status,
    errorText,
    isBusy,
    statusText: computed(() => t(`monitor.states.${status.value.state}`)),
    refreshStatus,
    startMonitor,
    stopMonitor,
    toggleMonitor() {
      return status.value.running ? stopMonitor() : startMonitor({});
    },
    ensureStreamConnected,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function __resetMonitorSwitchRuntimeForTest() {
  eventSource?.close?.();
  eventSource = null;
  refreshPromise = null;
  startPromise = null;
  stopPromise = null;
  listeners.clear();
  status.value = defaultStatus();
  errorText.value = '';
  isBusy.value = false;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/useMonitorSwitch.test.js`

Expected: PASS，目标用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/shared/useMonitorSwitch.js src/shared/useMonitorSwitch.test.js
git commit -m "feat: add shared monitor runtime"
```

---

## Task 2: Shared AutoOperation Agent Runtime

**Files:**
- Create: `src/shared/useAutoOperationAgentSwitch.js`
- Test: `src/shared/useAutoOperationAgentSwitch.test.js`

- [ ] **Step 1: 写失败测试，固定 Agent switch 的桌面能力、初始 Ping 和 load/unload 行为**

创建 `src/shared/useAutoOperationAgentSwitch.test.js`：

```js
/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAutoOperationAgentSwitchRuntimeForTest,
  useAutoOperationAgentSwitch,
} from './useAutoOperationAgentSwitch.js';

describe('useAutoOperationAgentSwitch', () => {
  beforeEach(() => {
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    delete window.bidkingDesktop;
  });

  it('is unavailable outside desktop mode', () => {
    const agent = useAutoOperationAgentSwitch();
    expect(agent.isAvailable.value).toBe(false);
    expect(agent.isConnected.value).toBe(false);
  });

  it('marks connected when Ping succeeds', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') return { ok: true, value: {} };
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const agent = useAutoOperationAgentSwitch();
    await agent.refreshAgentState();
    expect(agent.isConnected.value).toBe(true);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});
  });

  it('treats initial Ping failure as off but still allows explicit load and unload', async () => {
    const startAutoOperationAgent = vi.fn(async () => ({ ok: true, value: {} }));
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') throw new Error('offline');
      if (command === 'UnloadAgent') return { ok: true, value: { unloaded: true } };
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent,
      runAutoOperationCommand,
    };

    const agent = useAutoOperationAgentSwitch();
    await agent.refreshAgentState();
    expect(agent.isConnected.value).toBe(false);
    await agent.loadAgent();
    expect(agent.isConnected.value).toBe(true);
    await agent.unloadAgent();
    expect(agent.isConnected.value).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/useAutoOperationAgentSwitch.test.js`

Expected: FAIL，提示找不到 `./useAutoOperationAgentSwitch.js` 或导出缺失。

- [ ] **Step 3: 写最小实现，建立共享 Agent runtime**

创建 `src/shared/useAutoOperationAgentSwitch.js`：

```js
import { computed, ref } from 'vue';

const isConnected = ref(false);
const isBusy = ref(false);
const errorText = ref('');
let refreshPromise = null;
let actionPromise = null;

function getBridge() {
  const bridge = window.bidkingDesktop;
  if (!bridge?.isDesktop) return null;
  if (typeof bridge.startAutoOperationAgent !== 'function') return null;
  if (typeof bridge.runAutoOperationCommand !== 'function') return null;
  return bridge;
}

async function refreshAgentState({ silent = true } = {}) {
  if (refreshPromise) return refreshPromise;
  const bridge = getBridge();
  if (!bridge) {
    isConnected.value = false;
    return false;
  }
  refreshPromise = (async () => {
    try {
      await bridge.runAutoOperationCommand('Ping', {});
      isConnected.value = true;
      return true;
    } catch (error) {
      isConnected.value = false;
      if (!silent) errorText.value = error?.message || String(error);
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function loadAgent() {
  if (actionPromise) return actionPromise;
  const bridge = getBridge();
  if (!bridge) return false;
  errorText.value = '';
  isBusy.value = true;
  actionPromise = bridge.startAutoOperationAgent()
    .then(() => {
      isConnected.value = true;
      return true;
    })
    .catch((error) => {
      isConnected.value = false;
      errorText.value = error?.message || String(error);
      throw error;
    })
    .finally(() => {
      isBusy.value = false;
      actionPromise = null;
    });
  return actionPromise;
}

async function unloadAgent() {
  if (actionPromise) return actionPromise;
  const bridge = getBridge();
  if (!bridge) return false;
  errorText.value = '';
  isBusy.value = true;
  actionPromise = bridge.runAutoOperationCommand('UnloadAgent', {})
    .then(() => {
      isConnected.value = false;
      return true;
    })
    .catch((error) => {
      isConnected.value = true;
      errorText.value = error?.message || String(error);
      throw error;
    })
    .finally(() => {
      isBusy.value = false;
      actionPromise = null;
    });
  return actionPromise;
}

export function useAutoOperationAgentSwitch() {
  return {
    isAvailable: computed(() => Boolean(getBridge())),
    isConnected,
    isBusy,
    errorText,
    refreshAgentState,
    loadAgent,
    unloadAgent,
    toggleAgent() {
      return isConnected.value ? unloadAgent() : loadAgent();
    },
  };
}

export function __resetAutoOperationAgentSwitchRuntimeForTest() {
  refreshPromise = null;
  actionPromise = null;
  isConnected.value = false;
  isBusy.value = false;
  errorText.value = '';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/useAutoOperationAgentSwitch.test.js`

Expected: PASS，目标用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/shared/useAutoOperationAgentSwitch.js src/shared/useAutoOperationAgentSwitch.test.js
git commit -m "feat: add shared autooperation agent runtime"
```

---

## Task 3: TopBar Runtime Controls

**Files:**
- Create: `src/shared/topbar-controls.css`
- Modify: `src/shared/TopBar.vue`
- Modify: `src/shared/TopBar.test.js`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: 先写失败测试，固定顶栏开关可见性与交互**

在 `src/shared/TopBar.test.js` 顶部增加 composable mock，并补充用例：

```js
const monitorToggle = vi.fn();
const agentToggle = vi.fn();

vi.mock('./useMonitorSwitch.js', () => ({
  useMonitorSwitch: () => ({
    status: { value: { running: false, state: 'idle' } },
    statusText: { value: '待机' },
    errorText: { value: '' },
    isBusy: { value: false },
    refreshStatus: vi.fn(),
    ensureStreamConnected: vi.fn(),
    toggleMonitor: monitorToggle,
  }),
}));

vi.mock('./useAutoOperationAgentSwitch.js', () => ({
  useAutoOperationAgentSwitch: () => ({
    isAvailable: { value: true },
    isConnected: { value: false },
    errorText: { value: '' },
    isBusy: { value: false },
    refreshAgentState: vi.fn(),
    toggleAgent: agentToggle,
  }),
}));

it('renders monitor switch in the shared topbar', async () => {
  const w = mountBar();
  await flushPromises();
  expect(w.find('[data-testid="topbar-monitor-switch"]').exists()).toBe(true);
});

it('calls shared toggle handlers', async () => {
  const w = mountBar();
  await flushPromises();
  await w.find('[data-testid="topbar-monitor-switch"]').trigger('click');
  await w.find('[data-testid="topbar-agent-switch"]').trigger('click');
  expect(monitorToggle).toHaveBeenCalledTimes(1);
  expect(agentToggle).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/TopBar.test.js`

Expected: FAIL，因为 `TopBar.vue` 还没有渲染两个测试目标。

- [ ] **Step 3: 增加共享文案、样式并接入 composable**

在 `src/shared/messages.js` 的 `common` 下新增：

```js
      monitorSwitch: 'Monitor',
      agentSwitch: 'Agent',
```

创建 `src/shared/topbar-controls.css`：

```css
.topbar-runtime-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  padding: 8px 12px;
  cursor: pointer;
}

.topbar-runtime-switch.is-active .topbar-runtime-switch-track {
  background: linear-gradient(135deg, #1f8f5f, #35c487);
}
```

修改 `src/shared/TopBar.vue`：

```vue
<script setup>
import './topbar-controls.css';
import { onMounted } from 'vue';
import ThemeToggleIcon from './ThemeToggleIcon.vue';
import { useAutoOperationAgentSwitch } from './useAutoOperationAgentSwitch.js';
import { useI18n } from './i18n.js';
import { useMonitorSwitch } from './useMonitorSwitch.js';
import { useTheme } from './theme.js';

const monitor = useMonitorSwitch();
const agent = useAutoOperationAgentSwitch();

onMounted(() => {
  void monitor.refreshStatus();
  monitor.ensureStreamConnected();
  if (agent.isAvailable.value) void agent.refreshAgentState();
});
</script>
```

然后在现有顶栏模板中的 `</nav>` 与 `<slot />` 之间插入：

```vue
    <button
      data-testid="topbar-monitor-switch"
      class="topbar-runtime-switch"
      :class="{ 'is-active': monitor.status.value.running }"
      type="button"
      :disabled="monitor.isBusy.value"
      @click="monitor.toggleMonitor"
    >
      <span>{{ t('common.monitorSwitch') }}</span>
      <span class="topbar-runtime-switch-track" aria-hidden="true">
        <span class="topbar-runtime-switch-thumb"></span>
      </span>
    </button>

    <button
      v-if="agent.isAvailable.value"
      data-testid="topbar-agent-switch"
      class="topbar-runtime-switch"
      :class="{ 'is-active': agent.isConnected.value }"
      type="button"
      :disabled="agent.isBusy.value"
      @click="agent.toggleAgent"
    >
      <span>{{ t('common.agentSwitch') }}</span>
      <span class="topbar-runtime-switch-track" aria-hidden="true">
        <span class="topbar-runtime-switch-thumb"></span>
      </span>
    </button>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/TopBar.test.js`

Expected: PASS，顶栏 monitor / agent 开关用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/shared/topbar-controls.css src/shared/TopBar.vue src/shared/TopBar.test.js src/shared/messages.js
git commit -m "feat: add persistent topbar runtime controls"
```

---

## Task 4: Hero Estimator Consumes Shared Monitor Runtime

**Files:**
- Modify: `src/hero-estimator/HeroEstimatorPanelBody.vue`
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js`
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js`

- [ ] **Step 1: 写失败测试，固定 Ethan 页不再渲染旧局部 monitor switch**

在 `src/hero-estimator/HeroEstimatorPanel.test.js` 增加：

```js
it('does not render the old local monitor switch in Ethan page mode', async () => {
  const wrapper = mount(HeroEstimatorPanel, {
    props: { profile: ethanProfile, activePage: 'ethan' },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();

  expect(wrapper.find('#ethan-monitor-switch').exists()).toBe(false);
  expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js`

Expected: FAIL，因为 `HeroEstimatorPanelBody.vue` 还在页面头部渲染旧 switch。

- [ ] **Step 3: 删除局部 switch，并让 Hero Estimator 订阅共享 monitor runtime**

修改 `src/hero-estimator/HeroEstimatorPanelBody.vue`：

```vue
<TopBar v-if="!props.embedded" :active-page="props.activePage" />
```

修改 `src/hero-estimator/useHeroEstimatorPanel.js`：

```js
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';

export function useHeroEstimatorPanel(profile) {
  const monitorRuntime = useMonitorSwitch();
  const monitorStatus = monitorRuntime.status;
  const monitorStatusText = monitorRuntime.statusText;
  let removeMonitorSubscription = null;

  function handleSharedMonitorMessage(message) {
    if (!message || message.kind !== 'event') return;
    const payload = message.payload;
    // 这里继续沿用现有 Ethan/Elsa 事件解释逻辑
    handleMonitorPayload(payload);
  }

  onMounted(async () => {
    await monitorRuntime.refreshStatus();
    monitorRuntime.ensureStreamConnected();
    removeMonitorSubscription = monitorRuntime.subscribe(handleSharedMonitorMessage);
  });

  onBeforeUnmount(() => {
    removeMonitorSubscription?.();
  });
}
```

保留现有：

- Ethan / Elsa profile 识别
- outline / autofill / estimate refresh 逻辑
- monitor panel 展示

删除或替换现有：

- `fetchMonitorStatus()`
- `toggleMonitor()`
- `connectMonitorStream()`

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js`

Expected: PASS，旧开关消失，现有 Ethan/Elsa outline 相关用例继续通过。

- [ ] **Step 5: Commit**

```bash
git add src/hero-estimator/HeroEstimatorPanelBody.vue src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js
git commit -m "refactor: share monitor runtime across hero estimator pages"
```

---

## Task 5: Monitor And Inject Pages Use Shared Runtime

**Files:**
- Modify: `src/monitor/App.vue`
- Modify: `src/monitor/App.test.js`
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`

- [ ] **Step 1: 写失败测试，固定 `/Monitor` 和 `/Inject` 改为消费共享 runtime**

在 `src/monitor/App.test.js` 中 mock `useMonitorSwitch.js`，新增用例确认页面调用共享 `startMonitor(options)` / `stopMonitor()`。

示例：

```js
const startMonitor = vi.fn(async () => ({ state: 'capturing', running: true, totalEvents: 0, lastError: null }));
const stopMonitor = vi.fn(async () => ({ state: 'stopped', running: false, totalEvents: 0, lastError: null }));

vi.mock('../shared/useMonitorSwitch.js', () => ({
  useMonitorSwitch: () => ({
    status: { value: { state: 'idle', running: false, totalEvents: 0, lastError: null } },
    statusText: { value: '待机' },
    errorText: { value: '' },
    isBusy: { value: false },
    refreshStatus: vi.fn(),
    ensureStreamConnected: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    startMonitor,
    stopMonitor,
  }),
}));
```

在 `src/inject/App.test.js` 中 mock `useAutoOperationAgentSwitch.js`，新增用例确认 Agent 状态来自共享 runtime：

```js
vi.mock('../shared/useAutoOperationAgentSwitch.js', () => ({
  useAutoOperationAgentSwitch: () => ({
    isAvailable: { value: true },
    isConnected: { value: true },
    isBusy: { value: false },
    errorText: { value: '' },
    refreshAgentState: vi.fn(),
    loadAgent: vi.fn(),
    unloadAgent: vi.fn(),
    toggleAgent: vi.fn(),
  }),
}));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/monitor/App.test.js src/inject/App.test.js`

Expected: FAIL，因为两个页面还在各自拥有 monitor/agent 生命周期逻辑。

- [ ] **Step 3: 替换页面级 monitor / agent 状态 owner**

修改 `src/monitor/App.vue`：

```js
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';

const monitor = useMonitorSwitch();
const status = monitor.status;
const statusText = monitor.statusText;
let removeMonitorSubscription = null;

async function startMonitor() {
  actionError.value = '';
  await monitor.startMonitor({
    remoteAddress: form.remoteAddress.trim(),
    port: Number(form.port),
    batchSeconds: Number(form.batchSeconds),
    gameRoot: form.gameRoot.trim(),
    outputDir: form.outputDir.trim(),
  });
}

async function stopMonitor() {
  actionError.value = '';
  await monitor.stopMonitor();
}

onMounted(async () => {
  await monitor.refreshStatus();
  monitor.ensureStreamConnected();
  removeMonitorSubscription = monitor.subscribe((message) => {
    if (message?.kind !== 'event') return;
    appendEvent(message.payload);
  });
});
```

修改 `src/inject/App.vue`：

```js
import { useAutoOperationAgentSwitch } from '../shared/useAutoOperationAgentSwitch.js';

const agent = useAutoOperationAgentSwitch();

async function startAutoOperationAgent() {
  autoOperationError.value = '';
  await agent.loadAgent();
  autoOperationResult.value = { ok: agent.isConnected.value, value: {} };
}

async function runAutoOperationCommand(command) {
  const response = await window.bidkingDesktop.runAutoOperationCommand(command, args);
  if (command === 'Ping' || command === 'UnloadAgent') {
    await agent.refreshAgentState();
  }
  return response;
}
```

保持 `/Inject` 其他命令面板逻辑不变，只把顶层 agent 状态同步到共享 runtime。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/monitor/App.test.js src/inject/App.test.js`

Expected: PASS，两个页面继续可用且共享 runtime 状态。

- [ ] **Step 5: Commit**

```bash
git add src/monitor/App.vue src/monitor/App.test.js src/inject/App.vue src/inject/App.test.js
git commit -m "refactor: share monitor and agent runtime across monitor and inject pages"
```

---

## Task 6: Documentation And Verification

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 更新当前文档，记录顶栏 monitor / agent 开关行为**

在 `docs/Documentation.md` 中追加：

```md
## TopBar Runtime Controls

- `Monitor switch` 已从 Ethan 页面局部入口提升为 `TopBar` 常驻入口
- `Agent switch` 仅在桌面环境显示，并通过共享 runtime 与 `/Inject` 页同步
- renderer 侧 monitor 运行时现在只保留一条 `/api/bidking-monitor/events` 连接
```

- [ ] **Step 2: 跑目标测试集**

Run:

```bash
npx vitest run \
  src/shared/useMonitorSwitch.test.js \
  src/shared/useAutoOperationAgentSwitch.test.js \
  src/shared/TopBar.test.js \
  src/hero-estimator/HeroEstimatorPanel.test.js \
  src/monitor/App.test.js \
  src/inject/App.test.js
```

Expected: PASS

- [ ] **Step 3: 跑构建验证**

Run: `npm run build`

Expected: PASS，renderer 入口正常构建。

- [ ] **Step 4: Commit**

```bash
git add docs/Documentation.md
git commit -m "docs: record topbar monitor and agent controls"
```
