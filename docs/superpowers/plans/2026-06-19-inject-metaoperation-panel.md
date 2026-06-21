# Inject MetaOperation Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Inject `MetaOperation` panel under the `基础` group that exposes the seven existing `BKAutoOpAgent` meta-operation commands through direct UI actions and a latest-result JSON viewer.

**Architecture:** Keep this feature entirely on the Inject renderer side: wire a new standalone panel into `src/inject/App.vue`, consume the existing shared agent runtime via `useAutoOperationAgentRuntimeState()`, and execute commands through the existing `window.bidkingDesktop.runAutoOperationCommand()` bridge. Do not touch the already-dirty native `BKAutoOpAgent` files in this round; they already provide the seven commands this panel consumes.

**Tech Stack:** Vue 3 `<script setup>`, existing Inject workspace shell in `src/inject/App.vue`, shared `src/shared/messages.js` i18n, `src/inject/inject.css`, shared agent runtime state from `src/shared/useAutoOperationAgentSwitch.js`, `@vue/test-utils`, Vitest, existing preload `runAutoOperationCommand` bridge.

Reference spec:
- `docs/superpowers/specs/2026-06-19-inject-metaoperation-panel-design.md`

---

## File Structure

- **Create** `src/inject/panels/InjectMetaOperationPanel.vue` - dedicated standalone panel for the seven business-level Agent meta-operations, room dropdown state, latest result JSON, and shared command-lock relay.
- **Create** `src/inject/panels/InjectMetaOperationPanel.test.js` - focused panel tests for command dispatch, room dropdown semantics, transport gating, shared lock behavior, and latest-result preservation.
- **Modify** `src/inject/App.vue` - register the new `MetaOperation` nav item under `基础`, import/mount the new panel, and pass the shared `commandLoading` relay.
- **Modify** `src/inject/App.test.js` - cover the new basic-group nav item, on-demand panel mount, and at least one English label path.
- **Modify** `src/shared/messages.js` - add the new `inject.metaOperation*` and `inject.nav.metaOperation` keys in both locales.
- **Modify** `src/inject/inject.css` - add panel-specific layout/styling for the action cards, status strip, room select, and latest-result block.
- **Modify** `docs/Documentation.md` - update Inject current-state panel inventory and add fresh verification bullets.
- **Modify** `docs/ARCHITECTURE.md` - document the renderer-only MetaOperation entry surface and its boundary from the generic Controller console.

Do **not** modify these in this implementation plan:

- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`
- `tools/inject/AutoOperation/BKAutoOpAgent/*.o`

Those native files are already dirty in the current workspace and are out of scope for this renderer-only panel.

---

### Task 1: Wire the Inject workspace shell for the new MetaOperation panel

**Files:**
- Create: `src/inject/panels/InjectMetaOperationPanel.vue`
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: Add failing App-level tests for the new nav item and panel mount**

Extend `src/inject/App.test.js` with these tests near the existing Inject navigation coverage:

```js
  it('adds a metaoperation tab to the basic inject group and mounts the panel on demand', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="inject-nav-group-basic"]').text()).toContain('元操作');
    expect(wrapper.find('[data-testid="inject-panel-metaOperation"]').exists()).toBe(false);

    await activatePanel(wrapper, 'metaOperation');

    expect(wrapper.find('[data-testid="inject-panel-metaOperation"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="meta-operation-title"]').text()).toContain('元操作');
    expect(wrapper.find('[data-testid="meta-operation-command-GoToBattlePrev"]').exists()).toBe(true);
  });

  it('renders the metaoperation navigation label in English when locale is saved', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');

    const wrapper = await mountApp();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.find('[data-testid="inject-nav-group-basic"]').text()).toContain('MetaOperation');
  });
```

- [ ] **Step 2: Run the App tests to confirm the new shell is missing**

Run:

```bash
npx vitest run src/inject/App.test.js -t "metaoperation"
```

Expected: FAIL. `inject-tab-metaOperation` and `inject-panel-metaOperation` do not exist yet, and no `MetaOperation` messages are registered.

- [ ] **Step 3: Add the panel shell, nav entry, and i18n keys**

Update `src/inject/App.vue`:

```vue
<script setup>
import StockMovePanel from './StockMovePanel.vue';
import InjectAgentPanel from './panels/InjectAgentPanel.vue';
import InjectCabinetRewardPanel from './panels/InjectCabinetRewardPanel.vue';
import InjectCollectionScanPanel from './panels/InjectCollectionScanPanel.vue';
import InjectControllerPanel from './panels/InjectControllerPanel.vue';
import InjectDelayedPricePanel from './panels/InjectDelayedPricePanel.vue';
import InjectListingPanel from './panels/InjectListingPanel.vue';
import InjectMetaOperationPanel from './panels/InjectMetaOperationPanel.vue';
import InjectWarehousePanel from './panels/InjectWarehousePanel.vue';
import TopBar from '../shared/TopBar.vue';
```

```js
const workspaceNavGroups = [
  {
    id: 'basic',
    titleKey: 'inject.navGroups.basic',
    items: [
      { id: 'cabinet', titleKey: 'inject.nav.cabinet' },
      { id: 'agent', titleKey: 'inject.nav.agent' },
      { id: 'controller', titleKey: 'inject.nav.controller' },
      { id: 'metaOperation', titleKey: 'inject.nav.metaOperation' },
    ],
  },
```

```vue
        <section
          v-if="renderedPanels.metaOperation"
          v-show="activePanelId === 'metaOperation'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-metaOperation"
          :aria-label="t('inject.metaOperationTitle')"
        >
          <InjectMetaOperationPanel
            :command-loading="autoOperationCommandLoading"
            @command-loading-change="setAutoOperationCommandLoading"
          />
        </section>
```

Create a minimal mountable `src/inject/panels/InjectMetaOperationPanel.vue` shell so the App tests can go green before the full behavior work in Task 2:

```vue
<script setup>
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectMetaOperationPanel' });

defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

defineEmits(['command-loading-change']);

const { t } = useI18n();
</script>

<template>
  <div class="meta-operation-panel" data-testid="meta-operation-panel">
    <header class="section-head">
      <div>
        <h2 data-testid="meta-operation-title">{{ t('inject.metaOperationTitle') }}</h2>
        <p>{{ t('inject.metaOperationSubtitle') }}</p>
      </div>
    </header>

    <button
      class="command-button"
      type="button"
      data-testid="meta-operation-command-GoToBattlePrev"
      disabled
    >
      {{ t('inject.metaOperationGoToBattlePrev') }}
    </button>
  </div>
</template>
```

Add these initial message keys in `src/shared/messages.js` under both locales:

```js
      nav: {
        cabinet: '柜子奖励',
        agent: 'Agent 状态',
        controller: '控制器',
        metaOperation: '元操作',
        warehouse: '仓库统计',
```

```js
      metaOperationTitle: '元操作',
      metaOperationSubtitle: '直接触发现有 BKAutoOpAgent MetaOperation 命令。',
      metaOperationGoToBattlePrev: '前往房间页',
```

```js
      nav: {
        cabinet: 'Cabinet Reward',
        agent: 'Agent Status',
        controller: 'Controller',
        metaOperation: 'MetaOperation',
        warehouse: 'Warehouse Stats',
```

```js
      metaOperationTitle: 'MetaOperation',
      metaOperationSubtitle: 'Directly triggers the existing BKAutoOpAgent meta-operation commands.',
      metaOperationGoToBattlePrev: 'Go To Room Page',
```

- [ ] **Step 4: Re-run the App tests and confirm the shell wiring passes**

Run:

```bash
npx vitest run src/inject/App.test.js -t "metaoperation"
```

Expected: PASS. The `基础` group now includes `MetaOperation`, the panel mounts on demand, and the English nav label is rendered from i18n.

- [ ] **Step 5: Commit the shell wiring**

```bash
git add src/inject/App.vue src/inject/App.test.js src/inject/panels/InjectMetaOperationPanel.vue src/shared/messages.js
git commit -m "feat: add inject metaoperation panel shell"
```

---

### Task 2: Implement the MetaOperation panel behavior with dedicated panel tests

**Files:**
- Modify: `src/inject/panels/InjectMetaOperationPanel.vue`
- Create: `src/inject/panels/InjectMetaOperationPanel.test.js`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: Add failing panel tests for command dispatch, room selection, and latest-result behavior**

Create `src/inject/panels/InjectMetaOperationPanel.test.js`:

```js
/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectMetaOperationPanel from './InjectMetaOperationPanel.vue';
import {
  AGENT_CONNECTED_STORAGE_KEY,
  __resetAutoOperationAgentSwitchRuntimeForTest,
} from '../../shared/useAutoOperationAgentSwitch.js';

async function mountPanel(props = {}) {
  const wrapper = mount(InjectMetaOperationPanel, {
    attachTo: document.body,
    props,
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('InjectMetaOperationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.sessionStorage.clear();
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
  });

  it('renders all seven actions, Chinese room names, and the empty latest-result placeholder', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountPanel();

    expect(wrapper.get('[data-testid="meta-operation-command-GoToBattlePrev"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-EnterRoom"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-OpenSkillConfig"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-SelectRole"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-StartAction"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-GetBidState"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-PlaceBid"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-room-select"]').text()).toContain('快递盲盒堆');
    expect(wrapper.get('[data-testid="meta-operation-room-select"]').text()).toContain('深海沉船');
    expect(wrapper.get('[data-testid="meta-operation-room-select"]').element.value).toBe('101');
    expect(wrapper.get('[data-testid="meta-operation-result-placeholder"]').text()).toContain('尚无结果');
  });

  it('dispatches EnterRoom with the selected roomId and prints the latest formatted JSON result', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      result: { clicked: true, room: 102 },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-room-select"]').setValue('102');
    await wrapper.get('[data-testid="meta-operation-command-EnterRoom"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('EnterRoom', { roomId: 102 });
    expect(wrapper.get('[data-testid="meta-operation-latest-command"]').text()).toContain('EnterRoom');
    expect(wrapper.get('[data-testid="meta-operation-result-json"]').text()).toContain('"room": 102');
  });

  it('dispatches zero-arg meta-operations and preserves business no-op payloads', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      result: { clicked: false, reason: 'BattlePrevPanel_Main not visible' },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-command-GoToBattlePrev"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GoToBattlePrev', {});
    expect(wrapper.get('[data-testid="meta-operation-result-json"]').text()).toContain('"clicked": false');
    expect(wrapper.get('[data-testid="meta-operation-result-json"]').text()).toContain('BattlePrevPanel_Main not visible');
  });

  it('disables actions when transport is not ready or another panel holds the shared command lock', async () => {
    const wrapper = await mountPanel({ commandLoading: 'Controller:UI Refresh' });

    expect(wrapper.get('[data-testid="meta-operation-command-GoToBattlePrev"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-room-select"]').element.disabled).toBe(true);
  });

  it('writes a synthetic error payload and emits shared lock changes when bridge execution throws', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn().mockRejectedValue(new Error('bridge down'));
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-command-PlaceBid"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.emitted('command-loading-change')).toEqual([
      ['PlaceBid'],
      [''],
    ]);
    expect(wrapper.get('[data-testid="meta-operation-result-json"]').text()).toContain('"ok": false');
    expect(wrapper.get('[data-testid="meta-operation-result-json"]').text()).toContain('bridge down');
  });
});
```

- [ ] **Step 2: Run the panel tests to confirm the shell is still incomplete**

Run:

```bash
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected: FAIL. The shell panel does not render the full seven-command surface, has no room dropdown, no latest-result viewer, no command dispatch logic, and no shared-lock relay behavior.

- [ ] **Step 3: Implement the full MetaOperation panel behavior**

Replace `src/inject/panels/InjectMetaOperationPanel.vue` with:

```vue
<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectMetaOperationPanel' });

const props = defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const roomOptions = [
  { id: 101, label: '快递盲盒堆' },
  { id: 102, label: '废弃仓库' },
  { id: 103, label: '航运集装箱' },
  { id: 104, label: '空置别墅' },
  { id: 105, label: '沉船密封仓' },
  { id: 106, label: '隐秘拍卖会' },
  { id: 304, label: '幽静别墅' },
  { id: 305, label: '深海沉船' },
];

const selectedRoomId = ref(String(roomOptions[0].id));
const latestResultCommand = ref('');
const latestResultLabel = ref('');
const latestResultPayload = ref(null);
const panelError = ref('');
const localCommandLoading = ref('');

const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const transportReady = computed(() => Boolean(
  desktopReady.value &&
  agent.isAvailable.value &&
  agent.isConnected.value &&
  typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
));
const effectiveCommandLoading = computed(() => props.commandLoading || localCommandLoading.value);
const actionsEnabled = computed(() => Boolean(transportReady.value && !effectiveCommandLoading.value));
const latestResultText = computed(() => (
  latestResultPayload.value ? JSON.stringify(latestResultPayload.value, null, 2) : ''
));
const transportHint = computed(() => {
  if (!desktopReady.value) return t('inject.unavailable');
  if (!agent.isAvailable.value) return t('inject.metaOperationTransportHint');
  if (!agent.isConnected.value) return t('inject.controllerAgentDisconnectedHint');
  if (effectiveCommandLoading.value) return t('inject.controllerBusyHint');
  return t('inject.metaOperationReadyHint');
});

const actions = [
  { command: 'GoToBattlePrev', labelKey: 'inject.metaOperationGoToBattlePrev' },
  { command: 'OpenSkillConfig', labelKey: 'inject.metaOperationOpenSkillConfig' },
  { command: 'SelectRole', labelKey: 'inject.metaOperationSelectElsa' },
  { command: 'StartAction', labelKey: 'inject.metaOperationStartAction' },
  { command: 'GetBidState', labelKey: 'inject.metaOperationGetBidState' },
  { command: 'PlaceBid', labelKey: 'inject.metaOperationPlaceBid' },
];

function formatAvailability(value) {
  return value ? t('inject.controllerAvailable') : t('inject.controllerUnavailable');
}

function buildArgs(command) {
  if (command === 'EnterRoom') {
    return { roomId: Number(selectedRoomId.value) };
  }
  return {};
}

async function executeMetaOperation(command, labelKey) {
  if (!actionsEnabled.value) return;

  const label = t(labelKey);
  const args = buildArgs(command);
  panelError.value = '';
  localCommandLoading.value = command;
  emit('command-loading-change', command);

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(command, args);
    latestResultPayload.value = response;
    if (response?.ok === false) {
      panelError.value = response.error || t('inject.failed');
    }
    latestResultCommand.value = command;
    latestResultLabel.value = label;
  } catch (error) {
    const message = error?.message || t('inject.failed');
    panelError.value = message;
    latestResultCommand.value = command;
    latestResultLabel.value = label;
    latestResultPayload.value = {
      ok: false,
      error: message,
    };
  } finally {
    localCommandLoading.value = '';
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <div class="controller-panel meta-operation-panel" data-testid="meta-operation-panel">
    <header class="section-head">
      <div>
        <h2 data-testid="meta-operation-title">{{ t('inject.metaOperationTitle') }}</h2>
        <p>{{ t('inject.metaOperationSubtitle') }}</p>
      </div>
    </header>

    <p class="status-text" data-testid="meta-operation-transport-hint">{{ transportHint }}</p>
    <p v-if="panelError" class="status-text is-error" data-testid="meta-operation-error">{{ panelError }}</p>

    <div class="metric-grid meta-operation-status-grid">
      <div class="metric">
        <span>{{ t('inject.metaOperationDesktop') }}</span>
        <strong data-testid="meta-operation-status-desktop">{{ formatAvailability(desktopReady) }}</strong>
      </div>
      <div class="metric">
        <span>{{ t('inject.metaOperationAgentBridge') }}</span>
        <strong data-testid="meta-operation-status-bridge">{{ formatAvailability(agent.isAvailable) }}</strong>
      </div>
      <div class="metric">
        <span>{{ t('inject.metaOperationAgentConnection') }}</span>
        <strong data-testid="meta-operation-status-connection">{{ agent.statusText }}</strong>
      </div>
    </div>

    <div class="meta-operation-grid">
      <button
        v-for="action in actions"
        :key="action.command"
        class="command-button meta-operation-card"
        type="button"
        :data-testid="`meta-operation-command-${action.command}`"
        :disabled="!actionsEnabled"
        @click="executeMetaOperation(action.command, action.labelKey)"
      >
        {{ effectiveCommandLoading === action.command ? t('inject.metaOperationRunning') : t(action.labelKey) }}
      </button>

      <div class="meta-operation-card meta-operation-card--room">
        <label class="meta-operation-select">
          <span>{{ t('inject.metaOperationRoom') }}</span>
          <select
            :value="selectedRoomId"
            :disabled="!actionsEnabled"
            data-testid="meta-operation-room-select"
            @change="selectedRoomId = $event.target.value"
          >
            <option v-for="room in roomOptions" :key="room.id" :value="String(room.id)">{{ room.label }}</option>
          </select>
        </label>
        <button
          class="command-button"
          type="button"
          data-testid="meta-operation-command-EnterRoom"
          :disabled="!actionsEnabled"
          @click="executeMetaOperation('EnterRoom', 'inject.metaOperationEnterRoom')"
        >
          {{ effectiveCommandLoading === 'EnterRoom' ? t('inject.metaOperationRunning') : t('inject.metaOperationEnterRoom') }}
        </button>
      </div>
    </div>

    <section class="auto-op-command-panel meta-operation-result-panel">
      <header class="section-head meta-operation-result-head">
        <div>
          <h3>{{ t('inject.metaOperationLatestResult') }}</h3>
          <p v-if="latestResultCommand" data-testid="meta-operation-latest-command">
            {{ latestResultLabel }} · {{ latestResultCommand }}
          </p>
        </div>
      </header>

      <p
        v-if="!latestResultText"
        class="controller-response-placeholder"
        data-testid="meta-operation-result-placeholder"
      >
        {{ t('inject.metaOperationNoResult') }}
      </p>
      <pre
        v-else
        class="command-result"
        data-testid="meta-operation-result-json"
      >{{ latestResultText }}</pre>
    </section>
  </div>
</template>
```

Update `src/shared/messages.js` with the full key set used above in both locales:

```js
      metaOperationTitle: '元操作',
      metaOperationSubtitle: '直接触发现有 BKAutoOpAgent MetaOperation 命令。',
      metaOperationDesktop: '桌面环境',
      metaOperationAgentBridge: 'Agent 桥接可用性',
      metaOperationAgentConnection: 'Agent 当前状态',
      metaOperationTransportHint: '当前环境缺少 MetaOperation 桥接能力，暂时无法执行元操作。',
      metaOperationReadyHint: 'MetaOperation 通道已就绪，可直接执行元操作。',
      metaOperationLatestResult: '最近一次结果',
      metaOperationNoResult: '尚无结果。执行元操作后会在这里显示最新响应。',
      metaOperationLatestCommand: '最近命令',
      metaOperationRoom: '房间',
      metaOperationGoToBattlePrev: '前往房间页',
      metaOperationEnterRoom: '进入房间',
      metaOperationOpenSkillConfig: '打开技能配置',
      metaOperationSelectElsa: '选择艾莎',
      metaOperationStartAction: '开始行动',
      metaOperationGetBidState: '获取竞拍状态',
      metaOperationPlaceBid: '出价',
      metaOperationExecute: '执行',
      metaOperationRunning: '执行中',
```

```js
      metaOperationTitle: 'MetaOperation',
      metaOperationSubtitle: 'Directly triggers the existing BKAutoOpAgent meta-operation commands.',
      metaOperationDesktop: 'Desktop Environment',
      metaOperationAgentBridge: 'Agent Bridge Availability',
      metaOperationAgentConnection: 'Agent Status',
      metaOperationTransportHint: 'The current environment is missing the MetaOperation bridge, so actions cannot run yet.',
      metaOperationReadyHint: 'The MetaOperation transport is ready.',
      metaOperationLatestResult: 'Latest Result',
      metaOperationNoResult: 'No result yet. The latest response appears here after an action runs.',
      metaOperationLatestCommand: 'Latest Command',
      metaOperationRoom: 'Room',
      metaOperationGoToBattlePrev: 'Go To Room Page',
      metaOperationEnterRoom: 'Enter Room',
      metaOperationOpenSkillConfig: 'Open Skill Config',
      metaOperationSelectElsa: 'Select Elsa',
      metaOperationStartAction: 'Start Action',
      metaOperationGetBidState: 'Get Bid State',
      metaOperationPlaceBid: 'Place Bid',
      metaOperationExecute: 'Run',
      metaOperationRunning: 'Running',
```

Append panel styles in `src/inject/inject.css`:

```css
.meta-operation-panel {
  display: grid;
  gap: 14px;
}

.meta-operation-status-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.meta-operation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.meta-operation-card {
  min-height: 44px;
  padding: 0 14px;
}

.meta-operation-card--room {
  display: grid;
  gap: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 12px;
}

.meta-operation-select {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}

.meta-operation-select select {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  padding: 0 10px;
}

.meta-operation-result-panel {
  margin-top: 0;
}

.meta-operation-result-head {
  margin-bottom: 0;
}

@media (max-width: 760px) {
  .meta-operation-status-grid,
  .meta-operation-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run the dedicated panel tests and make them pass**

Run:

```bash
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected: PASS. The panel dispatches the correct command names/args, shows Chinese room names, preserves no-op payloads, disables actions when transport is unavailable, and writes synthetic error payloads on thrown bridge errors.

- [ ] **Step 5: Commit the panel implementation**

```bash
git add src/inject/panels/InjectMetaOperationPanel.vue src/inject/panels/InjectMetaOperationPanel.test.js src/shared/messages.js src/inject/inject.css
git commit -m "feat: add inject metaoperation actions"
```

---

### Task 3: Sync docs and run the verification chain

**Files:**
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update current-state documentation for the new Inject panel inventory**

In `docs/Documentation.md`, update the Inject workspace description so `基础` includes `元操作`, and add a new current-state note:

```md
- `src/inject/panels/InjectMetaOperationPanel.vue` 是一个独立的 Inject 业务入口层：它消费共享 agent runtime 的只读状态，通过现有 `runAutoOperationCommand(command, args)` bridge 直接暴露七个已存在的 `BKAutoOpAgent` MetaOperation（`GoToBattlePrev`、`EnterRoom`、`OpenSkillConfig`、`SelectRole`、`StartAction`、`GetBidState`、`PlaceBid`），并把最近一次响应展示为格式化 JSON；它不承载泛型命令输入，也不根据当前游戏画面做前端按钮级 gating。
```

In `docs/ARCHITECTURE.md`, add/update the Inject panel architecture note:

```md
- `InjectMetaOperationPanel.vue` 与 `InjectControllerPanel.vue` 的边界不同：前者是固定业务动作入口，后者仍是通用 Controller / UI automation 外壳。`InjectMetaOperationPanel.vue` 通过 `useAutoOperationAgentRuntimeState()` 读取桌面环境、bridge 可用性和 agent 连接状态，并通过 `src/inject/App.vue` 传入的共享 `commandLoading` relay 参与跨 panel AutoOperation 串行化；它不重新实现 agent 生命周期，也不直接消费 native UI tree。
```

- [ ] **Step 2: Append fresh verification bullets**

Append these bullets under `## 最新验证` in `docs/Documentation.md`:

```md
- 2026-06-19：`npx vitest run src/inject/App.test.js src/inject/panels/InjectMetaOperationPanel.test.js` 通过；覆盖 Inject `基础` 分组新增 `MetaOperation` tab、英文文案路径、七个元操作入口渲染、`EnterRoom` 中文房间下拉、正确命令分发、共享 command lock gating，以及最近一次结果 JSON 展示。
- 2026-06-19：`npm run build:inject` 通过；说明新增 `InjectMetaOperationPanel.vue`、i18n 和样式改动可正常构建到 `public/inject/`。
- 2026-06-19：`git diff --check` 无输出，说明这轮 MetaOperation panel 改动和文档同步未引入补丁格式问题。
```

- [ ] **Step 3: Run the verification chain**

Run:

```bash
npx vitest run src/inject/App.test.js src/inject/panels/InjectMetaOperationPanel.test.js
```

Expected: PASS.

Run:

```bash
npm run build:inject
```

Expected: PASS and rebuild `public/inject/`.

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit the docs sync**

`docs/` is ignored in this repo, so force-add the documentation files:

```bash
git add -f docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "docs: sync inject metaoperation panel"
```

---

## Self-Review

- **Spec coverage**
  - new standalone `MetaOperation` panel under Inject `基础`: Task 1
  - seven fixed business-level actions instead of a generic console: Task 2
  - `EnterRoom` Chinese room dropdown that still sends numeric `roomId`: Task 2
  - latest-result-only JSON viewer: Task 2
  - shared command lock reuse: Task 2
  - no front-end scene gating beyond transport readiness: Task 2
  - current-state docs updated in the same round: Task 3

- **Placeholder scan**
  - No `TODO` / `TBD`
  - Every code-changing step includes concrete code
  - Every verification step includes an exact command and expected result
  - Every file path is explicit

- **Type / naming consistency**
  - nav id stays `metaOperation`
  - App host test id stays `inject-panel-metaOperation`
  - room select test id stays `meta-operation-room-select`
  - result viewer remains `latest result`, not a multi-entry log
  - commands always dispatch through `runAutoOperationCommand(command, args)` with `{}` for zero-arg operations
