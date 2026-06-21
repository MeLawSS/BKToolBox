# Inject Controller Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `Controller` panel under the `Inject` workspace basic group, with a passive shared-agent readiness view, a disabled controller-command skeleton, four future business-domain cards, and synchronized current-state docs.

**Architecture:** Keep `Inject` as the workspace shell and add one new panel component only. Expose a read-only agent runtime view from `src/shared/useAutoOperationAgentSwitch.js` without `onMounted` probe side effects, then let `InjectControllerPanel.vue` consume that passive view while keeping `desktopReady` local and `controllerTransportReady` hardcoded to `false`. Wire the panel into `src/inject/App.vue`, keep all state local to the panel, and update `Documentation.md` / `ARCHITECTURE.md` in the same implementation round.

**Tech Stack:** Vue 3 `<script setup>`, shared `window.bidkingDesktop` preload bridge, shared `src/shared/messages.js` i18n, `@vue/test-utils`, Vitest, existing `src/inject/inject.css` styling system.

Reference design: `docs/superpowers/specs/2026-06-18-controller-panel-design.md`

---

## File Structure

- **Modify** `src/shared/useAutoOperationAgentSwitch.js` - add a passive, read-only runtime accessor that exposes shared bridge availability / connection status / status text without `onMounted` refresh side effects.
- **Modify** `src/shared/useAutoOperationAgentSwitch.test.js` - prove the passive accessor does not send a new `Ping` on mount and still reflects state that active consumers already refreshed.
- **Create** `src/inject/panels/InjectControllerPanel.vue` - render the new Controller panel UI and hold its local command-form state.
- **Create** `src/inject/panels/InjectControllerPanel.test.js` - cover localized headings, passive shared runtime consumption, disabled command skeleton, and domain cards.
- **Modify** `src/shared/messages.js` - add `inject.nav.controller`, `inject.controllerTitle`, `inject.controllerSubtitle`, readiness labels, command labels, placeholder copy, and four domain-card labels/descriptions in both locales.
- **Modify** `src/inject/inject.css` - add small, panel-local classes for the controller command textarea, inline transport hint, response placeholder, and domain-card grid while reusing existing `metric`, `command-button`, and `listing-advice-panel` visual language.
- **Modify** `src/inject/App.vue` - register the new nav item and mount `InjectControllerPanel` as a new workspace panel with no `commandLoading` prop.
- **Modify** `src/inject/App.test.js` - cover the new nav item, the mounted panel, no extra `Ping` on first open, state retention while switching inside Inject, and state reset after `bidking:leave-inject`.
- **Modify** `docs/Documentation.md` - fix the outdated Inject basic/trading panel list and describe the new Controller panel behavior.
- **Modify** `docs/ARCHITECTURE.md` - add the new panel to the Inject architecture section and document the passive shared-agent runtime read path.

---

### Task 1: Add a passive shared AutoOperation Agent runtime view

**Files:**
- Modify: `src/shared/useAutoOperationAgentSwitch.js`
- Modify: `src/shared/useAutoOperationAgentSwitch.test.js`

- [ ] **Step 1: Write the failing tests for a passive runtime accessor**

Add a second mount helper to `src/shared/useAutoOperationAgentSwitch.test.js`:

```js
function mountPassiveHook() {
  const Probe = defineComponent({
    setup() {
      return useAutoOperationAgentRuntimeState();
    },
    template: '<div />',
  });

  return mount(Probe, { attachTo: document.body });
}
```

Update the import list at the top of the test file:

```js
import {
  __resetAutoOperationAgentSwitchRuntimeForTest,
  useAutoOperationAgentRuntimeState,
  useAutoOperationAgentSwitch,
} from './useAutoOperationAgentSwitch.js';
```

Add these two tests near the end of `describe('useAutoOperationAgentSwitch', ...)`:

```js
it('exposes a passive runtime view without probing the agent on mount', async () => {
  const runAutoOperationCommand = vi.fn().mockResolvedValue({
    ok: true,
    value: { pong: true },
  });
  window.bidkingDesktop = {
    isDesktop: true,
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand,
  };

  const wrapper = mountPassiveHook();
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand).not.toHaveBeenCalled();
  expect(wrapper.vm.isAvailable).toBe(true);
  expect(wrapper.vm.isConnected).toBe(false);
  expect(wrapper.vm.statusText).toBe('等待获取');
});

it('lets passive consumers observe shared agent state after an active probe', async () => {
  const runAutoOperationCommand = vi.fn().mockResolvedValue({
    ok: true,
    value: { pong: true },
  });
  window.bidkingDesktop = {
    isDesktop: true,
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand,
  };

  const active = mountHook();
  await flushPromises();
  await nextTick();

  const passive = mountPassiveHook();
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
  expect(passive.vm.isAvailable).toBe(true);
  expect(passive.vm.isConnected).toBe(true);
  expect(passive.vm.statusText).toBe('已连接');

  active.unmount();
  passive.unmount();
});
```

- [ ] **Step 2: Run the shared-runtime tests and verify they fail first**

Run: `npx vitest run src/shared/useAutoOperationAgentSwitch.test.js`

Expected: FAIL with an import/export error for `useAutoOperationAgentRuntimeState`, because the passive accessor does not exist yet.

- [ ] **Step 3: Implement the passive accessor without changing active-hook behavior**

In `src/shared/useAutoOperationAgentSwitch.js`, add a shared view builder above `export function useAutoOperationAgentSwitch()`:

```js
function createRuntimeView(t) {
  return {
    isAvailable: computed(() => isAvailableBridge()),
    isConnected: connected,
    errorText,
    isBusy: busy,
    statusText: computed(() => {
      if (busy.value) return t('inject.autoOperationStarting');
      if (errorText.value) return t('inject.failed');
      return connected.value ? t('inject.autoOperationConnected') : t('inject.waiting');
    }),
  };
}

export function useAutoOperationAgentRuntimeState() {
  const { t } = useI18n();
  hydrateConnectedState();
  return createRuntimeView(t);
}
```

Then refactor `useAutoOperationAgentSwitch()` so it reuses the same runtime view and keeps the existing `onMounted` refresh behavior:

```js
export function useAutoOperationAgentSwitch() {
  const { t } = useI18n();
  hydrateConnectedState();

  onMounted(() => {
    if (isAvailableBridge()) {
      void refreshAgentState();
    } else {
      setConnected(false);
      errorText.value = '';
    }
  });

  return {
    ...createRuntimeView(t),
    refreshAgentState,
    loadAgent,
    unloadAgent,
    toggleAgent,
  };
}
```

This preserves `TopBar` / `InjectAgentPanel` behavior while giving `InjectControllerPanel` a no-refresh read-only entry point.

- [ ] **Step 4: Re-run the shared-runtime tests**

Run: `npx vitest run src/shared/useAutoOperationAgentSwitch.test.js`

Expected: PASS. Existing tests stay green, and the two new passive-view tests pass with exactly one `Ping` total in the active+passive scenario.

- [ ] **Step 5: Commit the shared-runtime task**

```bash
git add src/shared/useAutoOperationAgentSwitch.js src/shared/useAutoOperationAgentSwitch.test.js
git commit -m "feat: add passive auto-operation runtime view"
```

---

### Task 2: Build the Controller panel component, i18n, and local styles

**Files:**
- Create: `src/inject/panels/InjectControllerPanel.vue`
- Create: `src/inject/panels/InjectControllerPanel.test.js`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: Write the failing panel tests**

Create `src/inject/panels/InjectControllerPanel.test.js` with this content:

```js
/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectControllerPanel from './InjectControllerPanel.vue';
import { __resetAutoOperationAgentSwitchRuntimeForTest } from '../../shared/useAutoOperationAgentSwitch.js';

describe('InjectControllerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    window.sessionStorage.clear();
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
  });

  it('renders localized readiness cards and a disabled controller command skeleton', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = mount(InjectControllerPanel, { attachTo: document.body });
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('控制器');
    expect(wrapper.get('[data-testid="controller-status-desktop"]').text()).toContain('桌面环境');
    expect(wrapper.get('[data-testid="controller-status-agentBridge"]').text()).toContain('可用');
    expect(wrapper.get('[data-testid="controller-status-transport"]').text()).toContain('未接入');
    expect(wrapper.get('[data-testid="controller-send-button"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="controller-transport-not-ready"]').text()).toContain('Controller 通道尚未接入');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('Controller 通道接入后将在这里显示响应');
    expect(wrapper.get('[data-testid="controller-domain-character-scene"]').text()).toContain('角色 / 场景');
    expect(wrapper.get('[data-testid="controller-domain-trading-market"]').text()).toContain('交易 / 市场');
  });

  it('reads shared agent state passively without issuing Ping on mount', async () => {
    window.sessionStorage.setItem('bidking-auto-operation-agent-connected', 'true');
    const runAutoOperationCommand = vi.fn();
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = mount(InjectControllerPanel, { attachTo: document.body });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="controller-status-agentConnection"]').text()).toContain('已连接');
  });
});
```

- [ ] **Step 2: Run the new panel tests and confirm the file is missing**

Run: `npx vitest run src/inject/panels/InjectControllerPanel.test.js`

Expected: FAIL because `src/inject/panels/InjectControllerPanel.vue` does not exist yet.

- [ ] **Step 3: Implement the panel, messages, and styles**

In `src/shared/messages.js`, add these new keys under both locale branches inside `inject`:

```js
nav: {
  cabinet: '柜子奖励',
  agent: 'Agent 状态',
  controller: '控制器',
  warehouse: '仓库统计',
  stockMove: '批量移仓',
  listing: '上架建议',
  delayedPrice: '延迟查价',
  collectionScan: '长期扫描',
},
controllerTitle: '控制器',
controllerSubtitle: '通过 controller 与 injected agent 通信，并承载后续游戏内操作',
controllerDesktop: '桌面环境',
controllerAgentBridge: 'Agent 桥接可用性',
controllerAgentConnection: 'Agent 当前状态',
controllerTransport: 'Controller 通道状态',
controllerAvailable: '可用',
controllerUnavailable: '不可用',
controllerTransportUnavailable: '未接入',
controllerCommandName: '命令名',
controllerCommandArgs: 'JSON 参数',
controllerCommandSend: '发送',
controllerTransportHint: 'Controller 通道尚未接入，本区仅预留交互形态',
controllerResponsePlaceholder: 'Controller 通道接入后将在这里显示响应',
controllerDomainCharacterScene: '角色 / 场景',
controllerDomainCharacterSceneSub: '未来承载角色状态、场景切换和上下文读取。',
controllerDomainMovementInteraction: '移动 / 交互',
controllerDomainMovementInteractionSub: '未来承载移动、点击、交互和路径相关操作。',
controllerDomainInventoryWarehouse: '背包 / 仓库',
controllerDomainInventoryWarehouseSub: '未来承载背包、仓库和物品整理类操作。',
controllerDomainTradingMarket: '交易 / 市场',
controllerDomainTradingMarketSub: '未来承载交易所、上架与市场辅助操作。',
```

And under `en-US`:

```js
nav: {
  cabinet: 'Cabinet Reward',
  agent: 'Agent Status',
  controller: 'Controller',
  warehouse: 'Warehouse',
  stockMove: 'Stock Move',
  listing: 'Listing Advisor',
  delayedPrice: 'Delayed Price',
  collectionScan: 'Long Scan',
},
controllerTitle: 'Controller',
controllerSubtitle: 'Communicate with the injected agent through the controller and host future in-game operations',
controllerDesktop: 'Desktop environment',
controllerAgentBridge: 'Agent bridge availability',
controllerAgentConnection: 'Agent connection',
controllerTransport: 'Controller transport',
controllerAvailable: 'Available',
controllerUnavailable: 'Unavailable',
controllerTransportUnavailable: 'Not connected',
controllerCommandName: 'Command name',
controllerCommandArgs: 'JSON payload',
controllerCommandSend: 'Send',
controllerTransportHint: 'The Controller transport is not connected yet. This area only locks in the future interaction shape.',
controllerResponsePlaceholder: 'Responses will appear here after the Controller transport is connected.',
controllerDomainCharacterScene: 'Character / Scene',
controllerDomainCharacterSceneSub: 'Future character state, scene switching, and context reads.',
controllerDomainMovementInteraction: 'Movement / Interaction',
controllerDomainMovementInteractionSub: 'Future movement, clicking, interaction, and path actions.',
controllerDomainInventoryWarehouse: 'Inventory / Warehouse',
controllerDomainInventoryWarehouseSub: 'Future inventory, warehouse, and item-organization actions.',
controllerDomainTradingMarket: 'Trading / Market',
controllerDomainTradingMarketSub: 'Future exchange, listing, and market-assist actions.',
```

Create `src/inject/panels/InjectControllerPanel.vue`:

```vue
<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectControllerPanel' });

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const commandName = ref('');
const commandArgsText = ref('{\n  \n}');
const controllerTransportReady = computed(() => false);
const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const agentBridgeAvailable = computed(() => agent.isAvailable.value);
const agentStatusText = computed(() => agent.statusText.value);

const domainCards = [
  {
    id: 'character-scene',
    titleKey: 'inject.controllerDomainCharacterScene',
    subtitleKey: 'inject.controllerDomainCharacterSceneSub',
  },
  {
    id: 'movement-interaction',
    titleKey: 'inject.controllerDomainMovementInteraction',
    subtitleKey: 'inject.controllerDomainMovementInteractionSub',
  },
  {
    id: 'inventory-warehouse',
    titleKey: 'inject.controllerDomainInventoryWarehouse',
    subtitleKey: 'inject.controllerDomainInventoryWarehouseSub',
  },
  {
    id: 'trading-market',
    titleKey: 'inject.controllerDomainTradingMarket',
    subtitleKey: 'inject.controllerDomainTradingMarketSub',
  },
];

const desktopStatusText = computed(() =>
  desktopReady.value ? t('inject.controllerAvailable') : t('inject.controllerUnavailable'),
);

const transportStatusText = computed(() =>
  controllerTransportReady.value
    ? t('inject.controllerAvailable')
    : t('inject.controllerTransportUnavailable'),
);
</script>

<template>
  <section class="controller-panel">
    <header class="section-head">
      <div>
        <h2>{{ t('inject.controllerTitle') }}</h2>
        <p>{{ t('inject.controllerSubtitle') }}</p>
      </div>
    </header>

    <div class="metric-grid">
      <div class="metric" data-testid="controller-status-desktop">
        <span>{{ t('inject.controllerDesktop') }}</span>
        <strong>{{ desktopStatusText }}</strong>
      </div>
      <div class="metric" data-testid="controller-status-agentBridge">
        <span>{{ t('inject.controllerAgentBridge') }}</span>
        <strong>{{ agentBridgeAvailable ? t('inject.controllerAvailable') : t('inject.controllerUnavailable') }}</strong>
      </div>
      <div class="metric" data-testid="controller-status-agentConnection">
        <span>{{ t('inject.controllerAgentConnection') }}</span>
        <strong>{{ agentStatusText }}</strong>
      </div>
      <div class="metric" data-testid="controller-status-transport">
        <span>{{ t('inject.controllerTransport') }}</span>
        <strong>{{ transportStatusText }}</strong>
      </div>
    </div>

    <section class="listing-advice-panel controller-command-panel">
      <div class="controller-command-fields">
        <label>
          <span>{{ t('inject.controllerCommandName') }}</span>
          <input v-model="commandName" type="text" data-testid="controller-command-input" />
        </label>
        <label>
          <span>{{ t('inject.controllerCommandArgs') }}</span>
          <textarea v-model="commandArgsText" data-testid="controller-args-input"></textarea>
        </label>
      </div>

      <div class="controller-command-actions">
        <button
          class="command-button"
          type="button"
          disabled
          data-testid="controller-send-button"
        >
          {{ t('inject.controllerCommandSend') }}
        </button>
        <p class="status-text controller-inline-hint" data-testid="controller-transport-not-ready">
          {{ t('inject.controllerTransportHint') }}
        </p>
      </div>

      <div class="command-result controller-response-placeholder" data-testid="controller-response-log">
        {{ t('inject.controllerResponsePlaceholder') }}
      </div>
    </section>

    <section class="controller-domain-grid">
      <article
        v-for="card in domainCards"
        :key="card.id"
        class="controller-domain-card"
        :data-testid="`controller-domain-${card.id}`"
      >
        <h3>{{ t(card.titleKey) }}</h3>
        <p>{{ t(card.subtitleKey) }}</p>
      </article>
    </section>
  </section>
</template>
```

Append these rules near the end of `src/inject/inject.css`, before the mobile media query:

```css
.controller-panel {
  display: grid;
  gap: 16px;
}

.controller-command-panel {
  gap: 14px;
}

.controller-command-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 10px;
}

.controller-command-fields label {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}

.controller-command-fields input,
.controller-command-fields textarea {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  padding: 10px 12px;
}

.controller-command-fields input {
  min-height: 34px;
}

.controller-command-fields textarea {
  min-height: 120px;
  resize: vertical;
}

.controller-command-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.controller-inline-hint {
  margin: 0;
}

.controller-response-placeholder {
  color: var(--muted);
}

.controller-domain-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.controller-domain-card {
  display: grid;
  gap: 6px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 14px;
}

.controller-domain-card h3 {
  font-size: 15px;
  line-height: 1.25;
}

.controller-domain-card p {
  color: var(--muted);
}
```

And extend the existing mobile block:

```css
  .controller-command-fields,
  .controller-domain-grid {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 4: Run the new panel tests**

Run: `npx vitest run src/inject/panels/InjectControllerPanel.test.js`

Expected: PASS. The panel renders localized copy, keeps send disabled, and never issues `Ping` on mount.

- [ ] **Step 5: Commit the new panel task**

```bash
git add src/shared/messages.js src/inject/inject.css src/inject/panels/InjectControllerPanel.vue src/inject/panels/InjectControllerPanel.test.js
git commit -m "feat: add inject controller panel"
```

---

### Task 3: Wire Controller into the Inject workspace shell

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`

- [ ] **Step 1: Write the failing Inject app tests**

Add these tests to `src/inject/App.test.js`:

```js
it('adds a controller tab to the basic inject group and mounts the panel on demand', async () => {
  const wrapper = await mountApp();

  expect(wrapper.find('[data-testid="inject-nav-group-basic"]').text()).toContain('控制器');
  expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(false);

  await wrapper.find('[data-testid="inject-tab-controller"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="controller-send-button"]').attributes('disabled')).toBeDefined();
});

it('does not trigger an extra Ping when opening the controller panel', async () => {
  const runAutoOperationCommand = vi.fn().mockResolvedValue({
    ok: true,
    value: { pong: true },
  });
  window.bidkingDesktop = {
    isDesktop: true,
    queryCabinetReward: vi.fn(),
    claimCabinetReward: vi.fn(),
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand,
  };

  const wrapper = await mountApp();
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
  expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});

  await wrapper.find('[data-testid="inject-tab-controller"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
});

it('preserves and then clears controller inputs with the existing inject lifecycle', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="inject-tab-controller"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="controller-command-input"]').setValue('MoveToNpc');

  await wrapper.find('[data-testid="inject-tab-cabinet"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="inject-tab-controller"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="controller-command-input"]').element.value).toBe('MoveToNpc');

  window.dispatchEvent(new CustomEvent('bidking:leave-inject'));
  await nextTick();

  expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(false);

  await wrapper.find('[data-testid="inject-tab-controller"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="controller-command-input"]').element.value).toBe('');
});
```

- [ ] **Step 2: Run the Inject app tests and verify they fail**

Run: `npx vitest run src/inject/App.test.js`

Expected: FAIL because the Inject nav does not have a `controller` item yet, and there is no controller panel host.

- [ ] **Step 3: Wire the controller item and panel into App.vue**

In `src/inject/App.vue`, import the new panel:

```js
import InjectControllerPanel from './panels/InjectControllerPanel.vue';
```

Add the new basic-group nav item after `agent`:

```js
const workspaceNavGroups = [
  {
    id: 'basic',
    titleKey: 'inject.navGroups.basic',
    items: [
      { id: 'cabinet', titleKey: 'inject.nav.cabinet' },
      { id: 'agent', titleKey: 'inject.nav.agent' },
      { id: 'controller', titleKey: 'inject.nav.controller' },
    ],
  },
  {
    id: 'trading',
    titleKey: 'inject.navGroups.trading',
    items: [
      { id: 'warehouse', titleKey: 'inject.nav.warehouse' },
      { id: 'stockMove', titleKey: 'inject.nav.stockMove' },
      { id: 'listing', titleKey: 'inject.nav.listing' },
      { id: 'delayedPrice', titleKey: 'inject.nav.delayedPrice' },
      { id: 'collectionScan', titleKey: 'inject.nav.collectionScan' },
    ],
  },
];
```

Add the panel host section between `agent` and `warehouse`:

```vue
<section
  v-if="renderedPanels.controller"
  v-show="activePanelId === 'controller'"
  class="inject-panel workspace-shell__panel"
  data-testid="inject-panel-controller"
  :aria-label="t('inject.controllerTitle')"
>
  <InjectControllerPanel />
</section>
```

No change is required in `resetWorkspaceState()` beyond the new nav item, because the existing `renderedPanelIdSet = new Set(['cabinet'])` reset already forces all non-default panels, including `controller`, to unmount on `bidking:leave-inject`.

- [ ] **Step 4: Re-run the Inject app tests**

Run: `npx vitest run src/inject/App.test.js`

Expected: PASS. The controller panel mounts lazily, opening it does not increase the Ping count beyond the existing TopBar probe, and its local input resets after the existing Inject leave lifecycle.

- [ ] **Step 5: Commit the workspace wiring task**

```bash
git add src/inject/App.vue src/inject/App.test.js
git commit -m "feat: wire controller panel into inject workspace"
```

---

### Task 4: Sync current-state docs and run the final verification chain

**Files:**
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update current-state docs to match the new Inject panel structure**

In `docs/Documentation.md`, replace the current Inject page-duty bullet:

```md
- 基础 panel 为 `展示柜收益 / Agent 状态 / 仓库藏品`，交易 panel 为 `批量移仓 / 上架建议 / 延迟价格查询 / 收藏价格采集`
```

with:

```md
- 基础 panel 为 `展示柜收益 / Agent 状态 / 控制器`，交易 panel 为 `仓库统计 / 批量移仓 / 上架建议 / 延迟价格查询 / 收藏价格采集`
```

Then add a new bullet immediately after the `src/inject/panels/InjectAgentPanel.vue` line:

```md
- `src/inject/panels/InjectControllerPanel.vue` 提供未来 controller 工作台的首版壳层：只读显示桌面环境、共享 agent runtime 的桥接可用性/连接状态，以及一个 disabled 的 controller 命令骨架；它不会在首次挂载时额外触发新的 `Ping`。
```

In `docs/ARCHITECTURE.md`, update the Inject section’s key implementation list by inserting:

```md
- `src/inject/panels/InjectControllerPanel.vue`
```

after `InjectAgentPanel.vue`, and add this explanatory bullet after the `App.vue` responsibility line:

```md
- `InjectControllerPanel.vue` 当前通过 `src/shared/useAutoOperationAgentSwitch.js` 的无副作用只读视图消费共享 agent runtime，只展示 bridge 可用性、当前连接状态和未来 controller 命令骨架；它不会在 panel 首次挂载时自行触发新的 `Ping`。
```

- [ ] **Step 2: Run the targeted verification chain**

Run:

```bash
npx vitest run src/shared/useAutoOperationAgentSwitch.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js
```

Expected: PASS

Run:

```bash
npm run build:inject
```

Expected: PASS and emits the updated Inject bundle into `public/inject/`

Run:

```bash
git diff --check
```

Expected: no output

- [ ] **Step 3: Record fresh verification in `docs/Documentation.md`**

Add a new `2026-06-18` verification bullet under `## 最新验证`:

```md
- 2026-06-18：`npx vitest run src/shared/useAutoOperationAgentSwitch.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js` 通过；新增覆盖共享 agent runtime 的无副作用只读视图、`Controller` panel 的 disabled 命令骨架、以及首次打开 `Controller` panel 不会额外触发新的 `Ping`。
- 2026-06-18：`npm run build:inject` 通过，说明新增 `Controller` panel、Inject 导航项和相关 i18n / 样式改动可正常构建到 `public/inject/`。
- 2026-06-18：`git diff --check` 无输出，说明本轮 `Controller` panel 与 current-state 文档更新未引入空白或补丁格式问题。
```

- [ ] **Step 4: Commit docs and verification**

```bash
git add docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "docs: record inject controller panel current state"
```

---

## Self-Review

- **Spec coverage**
  - New `Controller` nav item and panel shell: Task 2 + Task 3
  - Passive shared agent runtime consumption with no extra mount `Ping`: Task 1 + Task 3
  - Disabled controller command skeleton with inline “not connected” hint: Task 2
  - Four future business-domain cards: Task 2
  - No `commandLoading` prop or cross-panel lock for Controller: Task 3
  - Current-state docs synchronized in same round: Task 4

- **Placeholder scan**
  - No `TODO` / `TBD`
  - Every task includes exact files, code snippets, commands, and expected outcomes

- **Type / naming consistency**
  - Passive hook name: `useAutoOperationAgentRuntimeState`
  - New nav id: `controller`
  - New panel component: `InjectControllerPanel`
  - New host test id: `inject-panel-controller`
  - Runtime status test ids: `controller-status-desktop`, `controller-status-agentBridge`, `controller-status-agentConnection`, `controller-status-transport`
