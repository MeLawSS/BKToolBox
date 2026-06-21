# Controller UI Operations Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured `UI 操作` sub-area inside the existing Inject `Controller` panel so users can inspect the current UI, switch among visible panels, browse interactive nodes, and run phase-1 click / set-text actions while keeping the generic command console intact.

**Architecture:** Keep `InjectControllerPanel.vue` as the page-facing shell for readiness cards and the existing generic command console, then add one focused child surface for `UI 操作` plus one focused composable for the refresh / selection / action transaction logic. The new structured UI must be activation-gated by `isActive`, use the existing page-level AutoOperation command lock end-to-end across refresh transactions, and stage `GetCurrentUI -> GetVisiblePanels -> DumpPanelTree` results so visible UI never mixes fresh header data with stale nodes.

**Tech Stack:** Vue 3 `<script setup>`, composables with refs/computed/watch, shared `window.bidkingDesktop.runAutoOperationCommand` preload bridge, `src/shared/messages.js` i18n, `@vue/test-utils`, Vitest, existing `src/inject/inject.css` styling system.

Reference design: `docs/superpowers/specs/2026-06-18-controller-ui-operations-panel-design.md`

---

## File Structure

- **Create** `src/inject/panels/useControllerUiAutomation.js` - transaction-oriented state and command orchestration for refresh, panel switching, node selection, click, and set-text actions.
- **Create** `src/inject/panels/useControllerUiAutomation.test.js` - unit tests for staged refresh commit, active-state auto-refresh, manual panel switching, stale-selection clearing, and shared command-lock semantics.
- **Create** `src/inject/panels/InjectUiAutomationPanel.vue` - `UI 操作` master-detail surface that renders current UI metadata, visible panel selector, interactive node list, node detail/actions, and structured result feedback.
- **Create** `src/inject/panels/InjectUiAutomationPanel.test.js` - component tests for placeholders, auto-refresh rendering, node selection, click/set-text actions, draft reset, truncated hint, and disabled states.
- **Modify** `src/inject/panels/InjectControllerPanel.vue` - add `isActive` prop, render the new child panel above the generic command console, and relay command-lock events upward.
- **Modify** `src/inject/panels/InjectControllerPanel.test.js` - keep generic console coverage, add `UI 操作` presence / activation coverage, and keep the “no extra Ping on mount” guarantee.
- **Modify** `src/inject/App.vue` - pass explicit `isActive` into `InjectControllerPanel.vue`.
- **Modify** `src/inject/App.test.js` - prove the structured UI only refreshes after controller activation, refreshes again on re-open, and still shares the existing runtime / command lock behavior.
- **Modify** `src/shared/messages.js` - add the new `inject.controllerUi*` and node-detail i18n keys in both locales.
- **Modify** `src/inject/inject.css` - add the master-detail layout, list-row selected state, placeholders, and action result styling for the new `UI 操作` surface.
- **Modify** `docs/Documentation.md` - update the current Inject page description from “generic controller console only” to “structured UI operations + generic console”, and record fresh verification bullets.
- **Modify** `docs/ARCHITECTURE.md` - document the new child component / composable split and the `isActive` activation contract.

---

### Task 1: Build the UI-automation composable and lock-bounded refresh transactions

**Files:**
- Create: `src/inject/panels/useControllerUiAutomation.js`
- Create: `src/inject/panels/useControllerUiAutomation.test.js`

- [ ] **Step 1: Write the failing composable tests**

Create `src/inject/panels/useControllerUiAutomation.test.js`:

```js
/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { useControllerUiAutomation } from './useControllerUiAutomation.js';

function mountUiAutomation(options = {}) {
  const isActive = ref(options.isActive ?? false);
  const transportReady = ref(options.transportReady ?? true);
  const commandLoading = ref(options.commandLoading ?? '');
  const loadingEvents = [];
  let api = null;

  const Probe = defineComponent({
    setup() {
      api = useControllerUiAutomation({
        isActive,
        transportReady,
        commandLoading,
        emitCommandLoadingChange(value) {
          loadingEvents.push(value);
        },
      });
      return api;
    },
    template: '<div />',
  });

  const wrapper = mount(Probe, { attachTo: document.body });
  return {
    wrapper,
    isActive,
    transportReady,
    commandLoading,
    loadingEvents,
    getApi() {
      return api;
    },
  };
}

describe('useControllerUiAutomation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-refreshes only after an inactive-to-active transition and commits header/tree together', async () => {
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
        return { ok: true, result: { panels: ['UIMain', 'TradingExchange_Main'] } };
      }
      if (command === 'DumpPanelTree') {
        expect(args).toEqual({
          panel: 'UIMain',
          rootPath: '',
          interactiveOnly: true,
          maxDepth: 4,
          nodeLimit: 200,
        });
        return {
          ok: true,
          result: {
            panel: 'UIMain',
            rootPath: '',
            truncated: false,
            nodes: [
              {
                path: 'BtnTrade',
                name: 'BtnTrade',
                active: true,
                interactive: true,
                componentTypes: ['Button'],
              },
            ],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: false, transportReady: true });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();

    harness.isActive.value = true;
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
    expect(api.currentMainPanel.value).toBe('UIMain');
    expect(api.visiblePanels.value).toEqual(['UIMain', 'TradingExchange_Main']);
    expect(api.selectedPanel.value).toBe('UIMain');
    expect(api.interactiveNodes.value).toEqual([
      expect.objectContaining({
        path: 'BtnTrade',
        componentTypes: ['Button'],
      }),
    ]);
    expect(api.hasLoadedUiAutomationOnce.value).toBe(true);
    expect(harness.loadingEvents[0]).not.toBe('');
    expect(harness.loadingEvents.at(-1)).toBe('');
  });

  it('preserves the committed selected panel when manual refresh still finds it visible', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnOpenPop', name: 'BtnOpenPop', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'BidPop_Main',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'InputRoot/PriceInput', name: 'PriceInput', active: true, interactive: true, componentTypes: ['TMP_InputField'] }],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'BidPop_Main',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'InputRoot/PriceInput', name: 'PriceInput', active: true, interactive: true, componentTypes: ['TMP_InputField'] }],
        },
      });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    await api.switchPanel('BidPop_Main');
    await flushPromises();
    await nextTick();

    await api.refreshUi({ preserveSelectedPanel: true });
    await flushPromises();
    await nextTick();

    expect(api.selectedPanel.value).toBe('BidPop_Main');
    expect(api.interactiveNodes.value[0].path).toBe('InputRoot/PriceInput');
  });

  it('keeps the previous committed header and node list when a refresh dump fails', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { panel: 'TradingExchange_Main' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['TradingExchange_Main'] } })
      .mockResolvedValueOnce({ ok: false, error: 'panel not visible' });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    expect(api.currentMainPanel.value).toBe('UIMain');
    expect(api.visiblePanels.value).toEqual(['UIMain']);
    expect(api.interactiveNodes.value[0].path).toBe('BtnTrade');

    await api.refreshUi({ preserveSelectedPanel: true });
    await flushPromises();
    await nextTick();

    expect(api.currentMainPanel.value).toBe('UIMain');
    expect(api.visiblePanels.value).toEqual(['UIMain']);
    expect(api.selectedPanel.value).toBe('UIMain');
    expect(api.interactiveNodes.value[0].path).toBe('BtnTrade');
    expect(api.uiAutomationError.value).toContain('panel not visible');
  });

  it('does not commit a new panel selection when the replacement dump fails', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({ ok: false, error: 'root path not found' });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    await api.switchPanel('BidPop_Main');
    await flushPromises();
    await nextTick();

    expect(api.selectedPanel.value).toBe('UIMain');
    expect(api.interactiveNodes.value[0].path).toBe('BtnTrade');
    expect(api.uiAutomationError.value).toContain('root path not found');
  });
});
```

- [ ] **Step 2: Run the composable tests and verify they fail first**

Run: `npx vitest run src/inject/panels/useControllerUiAutomation.test.js`

Expected: FAIL with `Cannot find module './useControllerUiAutomation.js'`.

- [ ] **Step 3: Implement the composable**

Create `src/inject/panels/useControllerUiAutomation.js`:

```js
import { computed, ref, watch } from 'vue';

const DUMP_DEFAULTS = Object.freeze({
  rootPath: '',
  interactiveOnly: true,
  maxDepth: 4,
  nodeLimit: 200,
});

function getBridgeRunner() {
  const run = window.bidkingDesktop?.runAutoOperationCommand;
  if (typeof run !== 'function') {
    throw new Error('runAutoOperationCommand unavailable');
  }
  return run;
}

function getPayload(response) {
  if (response?.ok === false) {
    throw new Error(response.error || response.message || 'AutoOperation command failed');
  }
  return response?.result ?? response?.value ?? response ?? {};
}

function normalizeNodes(payload) {
  if (!Array.isArray(payload?.nodes)) return [];
  return payload.nodes
    .map((node) => ({
      path: String(node?.path || ''),
      name: String(node?.name || node?.path || ''),
      componentTypes: Array.isArray(node?.componentTypes) ? node.componentTypes.map(String) : [],
      active: Boolean(node?.active),
      interactive: Boolean(node?.interactive),
    }))
    .filter((node) => node.path);
}

function resolveAutoSelectedPanel(currentMainPanel, visiblePanels) {
  if (currentMainPanel && visiblePanels.includes(currentMainPanel)) {
    return currentMainPanel;
  }
  return visiblePanels[0] || '';
}

function resolveManualRefreshPanel(previousSelectedPanel, currentMainPanel, visiblePanels) {
  if (previousSelectedPanel && visiblePanels.includes(previousSelectedPanel)) {
    return previousSelectedPanel;
  }
  return resolveAutoSelectedPanel(currentMainPanel, visiblePanels);
}

function supportsClick(node) {
  return Boolean(
    node &&
    (node.componentTypes.includes('Button') || node.componentTypes.includes('Toggle')),
  );
}

function supportsTextInput(node) {
  return Boolean(
    node &&
    (
      node.componentTypes.includes('TMP_InputField') ||
      node.componentTypes.includes('NumericInputField')
    ),
  );
}

export function useControllerUiAutomation({
  isActive,
  transportReady,
  commandLoading,
  emitCommandLoadingChange,
}) {
  const uiAutomationRefreshing = ref(false);
  const currentMainPanel = ref('');
  const visiblePanels = ref([]);
  const selectedPanel = ref('');
  const interactiveNodes = ref([]);
  const selectedNodePath = ref('');
  const nodeInputDraft = ref('');
  const nodeSubmitAfterInput = ref(false);
  const uiAutomationError = ref('');
  const uiActionError = ref('');
  const lastUiActionResult = ref(null);
  const hasLoadedUiAutomationOnce = ref(false);
  const nodeListTruncated = ref(false);
  const localCommandLoading = ref('');

  const effectiveCommandLoading = computed(() => commandLoading.value || localCommandLoading.value);
  const selectedNode = computed(() => (
    interactiveNodes.value.find((node) => node.path === selectedNodePath.value) || null
  ));
  const selectedNodeSupportsClick = computed(() => supportsClick(selectedNode.value));
  const selectedNodeSupportsTextInput = computed(() => supportsTextInput(selectedNode.value));
  const canRefreshUi = computed(() => Boolean(transportReady.value && !effectiveCommandLoading.value));
  const canSwitchPanels = computed(() => Boolean(transportReady.value && !effectiveCommandLoading.value));
  const canRunClickAction = computed(() => Boolean(
    transportReady.value &&
    !effectiveCommandLoading.value &&
    selectedNodeSupportsClick.value &&
    selectedPanel.value,
  ));
  const canRunSetTextAction = computed(() => Boolean(
    transportReady.value &&
    !effectiveCommandLoading.value &&
    selectedNodeSupportsTextInput.value &&
    selectedPanel.value,
  ));

  function setSelectedNode(nextPath) {
    selectedNodePath.value = nextPath;
    nodeInputDraft.value = '';
    nodeSubmitAfterInput.value = false;
    uiActionError.value = '';
  }

  function syncSelectionAfterNodes(nextNodes) {
    if (!selectedNodePath.value) return;
    if (!nextNodes.some((node) => node.path === selectedNodePath.value)) {
      selectedNodePath.value = '';
      nodeInputDraft.value = '';
      nodeSubmitAfterInput.value = false;
      uiActionError.value = '';
    }
  }

  async function runCommand(command, args) {
    const runner = getBridgeRunner();
    const response = await runner(command, args);
    return getPayload(response);
  }

  async function withCommandLock(label, callback) {
    if (effectiveCommandLoading.value) {
      throw new Error('command busy');
    }
    localCommandLoading.value = label;
    emitCommandLoadingChange(label);
    try {
      return await callback();
    } finally {
      localCommandLoading.value = '';
      emitCommandLoadingChange('');
    }
  }

  function commitDumpState({
    nextCurrentMainPanel,
    nextVisiblePanels,
    nextSelectedPanel,
    nextNodes,
    nextTruncated,
  }) {
    currentMainPanel.value = nextCurrentMainPanel;
    visiblePanels.value = nextVisiblePanels;
    selectedPanel.value = nextSelectedPanel;
    interactiveNodes.value = nextNodes;
    nodeListTruncated.value = nextTruncated;
    syncSelectionAfterNodes(nextNodes);
    hasLoadedUiAutomationOnce.value = true;
  }

  async function refreshUi({ preserveSelectedPanel } = { preserveSelectedPanel: true }) {
    if (!transportReady.value) return false;

    uiAutomationRefreshing.value = true;
    uiAutomationError.value = '';

    try {
      await withCommandLock('Controller:UI Refresh', async () => {
        const currentUiPayload = await runCommand('GetCurrentUI', {});
        const visiblePanelsPayload = await runCommand('GetVisiblePanels', {});
        const nextVisiblePanels = Array.isArray(visiblePanelsPayload?.panels)
          ? visiblePanelsPayload.panels.map(String)
          : [];
        const nextCurrentMainPanel = String(currentUiPayload?.panel || '');
        const nextSelectedPanel = preserveSelectedPanel
          ? resolveManualRefreshPanel(selectedPanel.value, nextCurrentMainPanel, nextVisiblePanels)
          : resolveAutoSelectedPanel(nextCurrentMainPanel, nextVisiblePanels);

        let nextNodes = [];
        let nextTruncated = false;
        if (nextSelectedPanel) {
          const dumpPayload = await runCommand('DumpPanelTree', {
            panel: nextSelectedPanel,
            ...DUMP_DEFAULTS,
          });
          nextNodes = normalizeNodes(dumpPayload);
          nextTruncated = Boolean(dumpPayload?.truncated);
        }

        commitDumpState({
          nextCurrentMainPanel,
          nextVisiblePanels,
          nextSelectedPanel,
          nextNodes,
          nextTruncated,
        });
      });
      return true;
    } catch (error) {
      uiAutomationError.value = error?.message || 'refresh failed';
      return false;
    } finally {
      uiAutomationRefreshing.value = false;
    }
  }

  async function switchPanel(nextPanel) {
    if (!nextPanel || nextPanel === selectedPanel.value) return true;
    if (!transportReady.value) return false;

    uiAutomationRefreshing.value = true;
    uiAutomationError.value = '';

    try {
      await withCommandLock('Controller:UI Switch Panel', async () => {
        const dumpPayload = await runCommand('DumpPanelTree', {
          panel: nextPanel,
          ...DUMP_DEFAULTS,
        });
        commitDumpState({
          nextCurrentMainPanel: currentMainPanel.value,
          nextVisiblePanels: [...visiblePanels.value],
          nextSelectedPanel: nextPanel,
          nextNodes: normalizeNodes(dumpPayload),
          nextTruncated: Boolean(dumpPayload?.truncated),
        });
      });
      return true;
    } catch (error) {
      uiAutomationError.value = error?.message || 'panel switch failed';
      return false;
    } finally {
      uiAutomationRefreshing.value = false;
    }
  }

  async function clickSelectedNode() {
    if (!canRunClickAction.value) return false;

    uiActionError.value = '';
    try {
      await withCommandLock('Controller:UI Click Node', async () => {
        const payload = await runCommand('ClickNode', {
          panel: selectedPanel.value,
          rootPath: '',
          path: selectedNode.value.path,
          pathMode: 'exact',
          component: 'auto',
        });
        lastUiActionResult.value = {
          action: 'ClickNode',
          panel: selectedPanel.value,
          path: selectedNode.value.path,
          payload,
        };
      });
      return true;
    } catch (error) {
      const message = error?.message || 'click failed';
      uiActionError.value = message;
      lastUiActionResult.value = {
        action: 'ClickNode',
        panel: selectedPanel.value,
        path: selectedNode.value?.path || '',
        payload: { ok: false, error: message },
      };
      return false;
    }
  }

  async function setSelectedNodeText() {
    if (!canRunSetTextAction.value) return false;

    uiActionError.value = '';
    try {
      await withCommandLock('Controller:UI Set Text', async () => {
        const payload = await runCommand('SetInputText', {
          panel: selectedPanel.value,
          rootPath: '',
          path: selectedNode.value.path,
          pathMode: 'exact',
          text: nodeInputDraft.value,
          submit: nodeSubmitAfterInput.value,
        });
        lastUiActionResult.value = {
          action: 'SetInputText',
          panel: selectedPanel.value,
          path: selectedNode.value.path,
          payload,
        };
      });
      return true;
    } catch (error) {
      const message = error?.message || 'set text failed';
      uiActionError.value = message;
      lastUiActionResult.value = {
        action: 'SetInputText',
        panel: selectedPanel.value,
        path: selectedNode.value?.path || '',
        payload: { ok: false, error: message },
      };
      return false;
    }
  }

  watch(
    () => [isActive.value, transportReady.value],
    ([nextActive, nextTransportReady], previous = []) => {
      const [previousActive, previousTransportReady] = previous;
      if (
        nextActive &&
        nextTransportReady &&
        (!previousActive || !previousTransportReady)
      ) {
        void refreshUi({ preserveSelectedPanel: true });
      }
    },
    { immediate: true },
  );

  return {
    uiAutomationRefreshing,
    currentMainPanel,
    visiblePanels,
    selectedPanel,
    interactiveNodes,
    selectedNodePath,
    selectedNode,
    selectedNodeSupportsClick,
    selectedNodeSupportsTextInput,
    nodeInputDraft,
    nodeSubmitAfterInput,
    uiAutomationError,
    uiActionError,
    lastUiActionResult,
    hasLoadedUiAutomationOnce,
    nodeListTruncated,
    effectiveCommandLoading,
    canRefreshUi,
    canSwitchPanels,
    canRunClickAction,
    canRunSetTextAction,
    setSelectedNode,
    refreshUi,
    switchPanel,
    clickSelectedNode,
    setSelectedNodeText,
  };
}
```

- [ ] **Step 4: Run the composable tests again**

Run: `npx vitest run src/inject/panels/useControllerUiAutomation.test.js`

Expected: PASS. The new composable proves activation-gated refresh, staged commit behavior, and panel-switch rollback semantics.

- [ ] **Step 5: Commit the composable task**

```bash
git add src/inject/panels/useControllerUiAutomation.js src/inject/panels/useControllerUiAutomation.test.js
git commit -m "feat: add controller ui automation composable"
```

---

### Task 2: Build the `UI 操作` child panel, i18n, and styling

**Files:**
- Create: `src/inject/panels/InjectUiAutomationPanel.vue`
- Create: `src/inject/panels/InjectUiAutomationPanel.test.js`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: Write the failing `UI 操作` panel tests**

Create `src/inject/panels/InjectUiAutomationPanel.test.js`:

```js
/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectUiAutomationPanel from './InjectUiAutomationPanel.vue';

async function mountPanel(props = {}) {
  const wrapper = mount(InjectUiAutomationPanel, {
    attachTo: document.body,
    props: {
      isActive: false,
      commandLoading: '',
      transportReady: true,
      transportHint: '',
      ...props,
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('InjectUiAutomationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows dedicated transport-not-ready placeholders instead of the ordinary empty states', async () => {
    const wrapper = await mountPanel({
      transportReady: false,
      transportHint: 'Agent offline',
    });

    expect(wrapper.get('[data-testid="controller-ui-operations"]').text()).toContain('UI 操作');
    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('通道未就绪');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('通道未就绪');
  });

  it('auto-refreshes on first active transition, renders interactive nodes, and updates details on selection', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
        return { ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } };
      }
      if (command === 'DumpPanelTree') {
        return {
          ok: true,
          result: {
            panel: 'UIMain',
            rootPath: '',
            truncated: true,
            nodes: [
              {
                path: 'BtnTrade',
                name: 'BtnTrade',
                active: true,
                interactive: true,
                componentTypes: ['Button'],
              },
              {
                path: 'InputRoot/PriceInput',
                name: 'PriceInput',
                active: true,
                interactive: true,
                componentTypes: ['TMP_InputField'],
              },
            ],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { runAutoOperationCommand };

    const wrapper = await mountPanel({ isActive: false, transportReady: true });
    expect(runAutoOperationCommand).not.toHaveBeenCalled();

    await wrapper.setProps({ isActive: true });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
    expect(wrapper.get('[data-testid="controller-ui-current-main"]').text()).toContain('UIMain');
    expect(wrapper.get('[data-testid="controller-ui-truncated"]').text()).toContain('结果已截断');
    expect(wrapper.get('[data-testid="controller-ui-node-row-0"]').text()).toContain('BtnTrade');
    expect(wrapper.get('[data-testid="controller-ui-node-row-1"]').text()).toContain('PriceInput');

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    expect(wrapper.get('[data-testid="controller-ui-detail-path"]').text()).toContain('InputRoot/PriceInput');
    expect(wrapper.get('[data-testid="controller-ui-detail-types"]').text()).toContain('TMP_InputField');
  });

  it('sends ClickNode for clickable nodes', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: { clicked: true, resolvedPath: 'BtnTrade', component: 'button' },
      });
    window.bidkingDesktop = { runAutoOperationCommand };

    const wrapper = await mountPanel({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-click-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('ClickNode', {
      panel: 'UIMain',
      rootPath: '',
      path: 'BtnTrade',
      pathMode: 'exact',
      component: 'auto',
    });
    expect(wrapper.get('[data-testid="controller-ui-action-result"]').text()).toContain('ClickNode');
  });

  it('sends SetInputText for input nodes and resets the draft when selection changes', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [
            { path: 'InputRoot/PriceInput', name: 'PriceInput', active: true, interactive: true, componentTypes: ['TMP_InputField'] },
            { path: 'InputRoot/FeeInput', name: 'FeeInput', active: true, interactive: true, componentTypes: ['NumericInputField'] },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          updated: true,
          resolvedPath: 'InputRoot/PriceInput',
          component: 'tmp-input',
          text: '7799',
        },
      });
    window.bidkingDesktop = { runAutoOperationCommand };

    const wrapper = await mountPanel({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-input-draft"]').setValue('7799');
    await wrapper.get('[data-testid="controller-ui-submit-toggle"]').setValue(true);
    await wrapper.get('[data-testid="controller-ui-set-text-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('SetInputText', {
      panel: 'UIMain',
      rootPath: '',
      path: 'InputRoot/PriceInput',
      pathMode: 'exact',
      text: '7799',
      submit: true,
    });

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    expect(wrapper.get('[data-testid="controller-ui-input-draft"]').element.value).toBe('');
  });
});
```

- [ ] **Step 2: Run the child-panel tests and verify they fail first**

Run: `npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js`

Expected: FAIL with `Cannot find module './InjectUiAutomationPanel.vue'`.

- [ ] **Step 3: Add i18n keys, styles, and implement the child panel**

Add these keys under both locale branches inside `inject` in `src/shared/messages.js`:

```js
controllerUiOperations: 'UI 操作',
controllerRefreshUi: '刷新 UI',
controllerUiTransportNotReady: 'Controller 通道未就绪，暂时无法读取当前 UI 与交互节点',
controllerCurrentMainUi: '当前主界面',
controllerVisiblePanels: '可见 Panel',
controllerSelectedPanel: '当前 Panel',
controllerInteractiveNodes: '可交互节点',
controllerNodeDetails: '节点详情',
controllerNodePath: '节点路径',
controllerNodeTypes: '组件类型',
controllerNodeActive: 'Active',
controllerNodeInteractive: 'Interactive',
controllerClickAction: '点击',
controllerSetTextAction: '设置文本',
controllerSubmitAfterSetText: '设置后提交',
controllerUiActionResult: '最近一次操作结果',
controllerNodeListNotRefreshed: '尚未刷新 UI。打开 Controller 或点击“刷新 UI”后会在这里显示当前 Panel 的交互节点。',
controllerNodeListRefreshing: '正在刷新当前 UI 与交互节点...',
controllerNodeListNoVisiblePanels: '当前没有可见 Panel。',
controllerNodeListEmpty: '当前 Panel 没有可交互节点。',
controllerNoSelectedNode: '选择左侧节点后，这里会显示路径、组件类型和可执行动作。',
controllerNodeListTruncated: '结果已截断，当前列表可能不完整。',
controllerBooleanYes: '是',
controllerBooleanNo: '否',
```

```js
controllerUiOperations: 'UI Operations',
controllerRefreshUi: 'Refresh UI',
controllerUiTransportNotReady: 'The Controller transport is not ready, so the current UI and interactive nodes are unavailable.',
controllerCurrentMainUi: 'Current main UI',
controllerVisiblePanels: 'Visible panels',
controllerSelectedPanel: 'Selected panel',
controllerInteractiveNodes: 'Interactive nodes',
controllerNodeDetails: 'Node details',
controllerNodePath: 'Node path',
controllerNodeTypes: 'Component types',
controllerNodeActive: 'Active',
controllerNodeInteractive: 'Interactive',
controllerClickAction: 'Click',
controllerSetTextAction: 'Set text',
controllerSubmitAfterSetText: 'Submit after set',
controllerUiActionResult: 'Last UI action result',
controllerNodeListNotRefreshed: 'The UI has not been refreshed yet. Open Controller or click "Refresh UI" to load interactive nodes for the current panel.',
controllerNodeListRefreshing: 'Refreshing the current UI and interactive nodes...',
controllerNodeListNoVisiblePanels: 'There are no visible panels right now.',
controllerNodeListEmpty: 'The selected panel has no interactive nodes.',
controllerNoSelectedNode: 'Select a node on the left to inspect its path, component types, and supported actions.',
controllerNodeListTruncated: 'The dump result was truncated, so this list may be incomplete.',
controllerBooleanYes: 'Yes',
controllerBooleanNo: 'No',
```

Append these styles to `src/inject/inject.css` above the mobile media block:

```css
.controller-ui-panel {
  display: grid;
  gap: 14px;
}

.controller-ui-head {
  display: grid;
  gap: 12px;
  margin-bottom: 0;
}

.controller-ui-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px) auto;
  gap: 10px;
  align-items: end;
}

.controller-ui-summary,
.controller-ui-select {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}

.controller-ui-select select,
.controller-ui-input-field {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  padding: 0 10px;
}

.controller-ui-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  gap: 14px;
}

.controller-ui-column,
.controller-ui-node-list,
.controller-ui-detail-grid {
  display: grid;
  gap: 10px;
}

.controller-ui-placeholder {
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--muted);
  padding: 14px;
}

.controller-ui-node-button {
  display: grid;
  gap: 5px;
  width: 100%;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  padding: 12px;
  text-align: left;
}

.controller-ui-node-button.is-selected {
  border-color: rgba(57, 168, 149, 0.65);
  background: rgba(47, 143, 131, 0.12);
}

.controller-ui-node-meta,
.controller-ui-detail-grid span {
  color: var(--muted);
  font-size: 12px;
}

.controller-ui-actions {
  display: grid;
  gap: 10px;
}

.controller-ui-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
```

Extend the existing mobile block in `src/inject/inject.css`:

```css
  .controller-ui-toolbar,
  .controller-ui-body {
    grid-template-columns: 1fr;
  }
```

Create `src/inject/panels/InjectUiAutomationPanel.vue`:

```vue
<script setup>
import { computed, toRef } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useControllerUiAutomation } from './useControllerUiAutomation.js';

defineOptions({ name: 'InjectUiAutomationPanel' });

const props = defineProps({
  isActive: {
    type: Boolean,
    default: false,
  },
  commandLoading: {
    type: String,
    default: '',
  },
  transportReady: {
    type: Boolean,
    default: false,
  },
  transportHint: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();
const {
  uiAutomationRefreshing,
  currentMainPanel,
  visiblePanels,
  selectedPanel,
  interactiveNodes,
  selectedNodePath,
  selectedNode,
  selectedNodeSupportsClick,
  selectedNodeSupportsTextInput,
  nodeInputDraft,
  nodeSubmitAfterInput,
  uiAutomationError,
  uiActionError,
  lastUiActionResult,
  hasLoadedUiAutomationOnce,
  nodeListTruncated,
  canRefreshUi,
  canSwitchPanels,
  canRunClickAction,
  canRunSetTextAction,
  setSelectedNode,
  refreshUi,
  switchPanel,
  clickSelectedNode,
  setSelectedNodeText,
} = useControllerUiAutomation({
  isActive: toRef(props, 'isActive'),
  transportReady: toRef(props, 'transportReady'),
  commandLoading: toRef(props, 'commandLoading'),
  emitCommandLoadingChange(value) {
    emit('command-loading-change', value);
  },
});

const selectedNodeTypesText = computed(() => (
  selectedNode.value?.componentTypes?.join(', ') || '-'
));

const actionResultText = computed(() => (
  lastUiActionResult.value
    ? JSON.stringify(lastUiActionResult.value, null, 2)
    : ''
));

function formatBoolean(value) {
  return value ? t('inject.controllerBooleanYes') : t('inject.controllerBooleanNo');
}
</script>

<template>
  <section class="listing-advice-panel controller-ui-panel" data-testid="controller-ui-operations">
    <header class="section-head controller-ui-head">
      <div>
        <h2>{{ t('inject.controllerUiOperations') }}</h2>
        <p>{{ transportReady ? t('inject.controllerRefreshUi') : transportHint }}</p>
      </div>
      <div class="controller-ui-toolbar">
        <div class="controller-ui-summary">
          <span>{{ t('inject.controllerCurrentMainUi') }}</span>
          <strong data-testid="controller-ui-current-main">{{ currentMainPanel || '-' }}</strong>
        </div>
        <label class="controller-ui-select">
          <span>{{ t('inject.controllerVisiblePanels') }}</span>
          <select
            :value="selectedPanel"
            :disabled="!canSwitchPanels || visiblePanels.length === 0"
            data-testid="controller-ui-panel-select"
            @change="switchPanel($event.target.value)"
          >
            <option v-for="panel in visiblePanels" :key="panel" :value="panel">{{ panel }}</option>
          </select>
        </label>
        <button
          class="command-button"
          type="button"
          :disabled="!canRefreshUi"
          data-testid="controller-ui-refresh-button"
          @click="refreshUi({ preserveSelectedPanel: true })"
        >
          {{ uiAutomationRefreshing ? t('inject.autoOperationRunning') : t('inject.controllerRefreshUi') }}
        </button>
      </div>
    </header>

    <p
      v-if="uiAutomationError"
      class="status-text is-error"
      data-testid="controller-ui-error"
    >
      {{ uiAutomationError }}
    </p>
    <p
      v-if="nodeListTruncated"
      class="status-text"
      data-testid="controller-ui-truncated"
    >
      {{ t('inject.controllerNodeListTruncated') }}
    </p>

    <div class="controller-ui-body">
      <section class="controller-ui-column">
        <h3>{{ t('inject.controllerInteractiveNodes') }}</h3>
        <div
          v-if="!transportReady"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ t('inject.controllerUiTransportNotReady') }}
        </div>
        <div
          v-else-if="!hasLoadedUiAutomationOnce && !uiAutomationRefreshing"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ t('inject.controllerNodeListNotRefreshed') }}
        </div>
        <div
          v-else-if="uiAutomationRefreshing"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ t('inject.controllerNodeListRefreshing') }}
        </div>
        <div
          v-else-if="visiblePanels.length === 0"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ t('inject.controllerNodeListNoVisiblePanels') }}
        </div>
        <div
          v-else-if="interactiveNodes.length === 0"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ t('inject.controllerNodeListEmpty') }}
        </div>
        <div v-else class="controller-ui-node-list">
          <button
            v-for="(node, index) in interactiveNodes"
            :key="node.path"
            class="controller-ui-node-button"
            :class="{ 'is-selected': node.path === selectedNodePath }"
            type="button"
            :data-testid="`controller-ui-node-row-${index}`"
            @click="setSelectedNode(node.path)"
          >
            <strong>{{ node.name }}</strong>
            <code>{{ node.path }}</code>
            <span class="controller-ui-node-meta">{{ node.componentTypes.join(', ') }}</span>
          </button>
        </div>
      </section>

      <section class="controller-ui-column">
        <h3>{{ t('inject.controllerNodeDetails') }}</h3>
        <div
          v-if="!transportReady || !selectedNode"
          class="controller-ui-placeholder"
          data-testid="controller-ui-detail-placeholder"
        >
          {{ transportReady ? t('inject.controllerNoSelectedNode') : t('inject.controllerUiTransportNotReady') }}
        </div>
        <template v-else>
          <div class="controller-ui-detail-grid">
            <div>
              <span>{{ t('inject.controllerSelectedPanel') }}</span>
              <strong>{{ selectedPanel }}</strong>
            </div>
            <div data-testid="controller-ui-detail-path">
              <span>{{ t('inject.controllerNodePath') }}</span>
              <strong>{{ selectedNode.path }}</strong>
            </div>
            <div data-testid="controller-ui-detail-types">
              <span>{{ t('inject.controllerNodeTypes') }}</span>
              <strong>{{ selectedNodeTypesText }}</strong>
            </div>
            <div>
              <span>{{ t('inject.controllerNodeActive') }}</span>
              <strong>{{ formatBoolean(selectedNode.active) }}</strong>
            </div>
            <div>
              <span>{{ t('inject.controllerNodeInteractive') }}</span>
              <strong>{{ formatBoolean(selectedNode.interactive) }}</strong>
            </div>
          </div>

          <p
            v-if="uiActionError"
            class="status-text is-error"
            data-testid="controller-ui-action-error"
          >
            {{ uiActionError }}
          </p>

          <div class="controller-ui-actions">
            <div class="controller-ui-detail-actions">
              <button
                v-if="selectedNodeSupportsClick"
                class="command-button"
                type="button"
                :disabled="!canRunClickAction"
                data-testid="controller-ui-click-button"
                @click="clickSelectedNode"
              >
                {{ t('inject.controllerClickAction') }}
              </button>
            </div>

            <template v-if="selectedNodeSupportsTextInput">
              <label class="controller-ui-select">
                <span>{{ t('inject.controllerSetTextAction') }}</span>
                <input
                  v-model="nodeInputDraft"
                  class="controller-ui-input-field"
                  type="text"
                  data-testid="controller-ui-input-draft"
                />
              </label>
              <label class="controller-ui-select">
                <span>{{ t('inject.controllerSubmitAfterSetText') }}</span>
                <input
                  v-model="nodeSubmitAfterInput"
                  type="checkbox"
                  data-testid="controller-ui-submit-toggle"
                />
              </label>
              <button
                class="command-button"
                type="button"
                :disabled="!canRunSetTextAction"
                data-testid="controller-ui-set-text-button"
                @click="setSelectedNodeText"
              >
                {{ t('inject.controllerSetTextAction') }}
              </button>
            </template>
          </div>

          <pre
            v-if="lastUiActionResult"
            class="command-result"
            data-testid="controller-ui-action-result"
          >{{ actionResultText }}</pre>
        </template>
      </section>
    </div>
  </section>
</template>
```

- [ ] **Step 4: Run the child-panel tests again**

Run: `npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js`

Expected: PASS. The new panel renders the dedicated transport placeholder, activation-gated auto-refresh, node selection, click/set-text actions, and truncated-results hint.

- [ ] **Step 5: Commit the child-panel task**

```bash
git add src/inject/panels/InjectUiAutomationPanel.vue src/inject/panels/InjectUiAutomationPanel.test.js src/shared/messages.js src/inject/inject.css
git commit -m "feat: add controller ui operations surface"
```

---

### Task 3: Integrate `UI 操作` into the Controller shell and Inject workspace

**Files:**
- Modify: `src/inject/panels/InjectControllerPanel.vue`
- Modify: `src/inject/panels/InjectControllerPanel.test.js`
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`

- [ ] **Step 1: Write the failing integration tests**

Add this test to `src/inject/panels/InjectControllerPanel.test.js`:

```js
it('renders the structured UI operations area and auto-refreshes it only when activated', async () => {
  window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
  const runAutoOperationCommand = vi.fn(async (command) => {
    if (command === 'GetCurrentUI') return { ok: true, result: { panel: 'UIMain' } };
    if (command === 'GetVisiblePanels') return { ok: true, result: { panels: ['UIMain'] } };
    if (command === 'DumpPanelTree') {
      return {
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });
  window.bidkingDesktop = {
    isDesktop: true,
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand,
  };

  const wrapper = mount(InjectControllerPanel, {
    attachTo: document.body,
    props: {
      isActive: false,
      commandLoading: '',
    },
  });
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand).not.toHaveBeenCalled();
  expect(wrapper.get('[data-testid="controller-ui-operations"]').exists()).toBe(true);

  await wrapper.setProps({ isActive: true });
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
    'GetCurrentUI',
    'GetVisiblePanels',
    'DumpPanelTree',
  ]);
});
```

Add this test to `src/inject/App.test.js`:

```js
it('auto-refreshes controller UI on first open and again on re-open without adding another Ping', async () => {
  const runAutoOperationCommand = vi.fn(async (command) => {
    if (command === 'Ping') return { ok: true, value: { pong: true } };
    if (command === 'GetCurrentUI') return { ok: true, result: { panel: 'UIMain' } };
    if (command === 'GetVisiblePanels') return { ok: true, result: { panels: ['UIMain'] } };
    if (command === 'DumpPanelTree') {
      return {
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      };
    }
    throw new Error(`unexpected command: ${command}`);
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

  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual(['Ping']);

  await activatePanel(wrapper, 'controller');
  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
    'Ping',
    'GetCurrentUI',
    'GetVisiblePanels',
    'DumpPanelTree',
  ]);

  await activatePanel(wrapper, 'cabinet');
  await activatePanel(wrapper, 'controller');

  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
    'Ping',
    'GetCurrentUI',
    'GetVisiblePanels',
    'DumpPanelTree',
    'GetCurrentUI',
    'GetVisiblePanels',
    'DumpPanelTree',
  ]);
});
```

- [ ] **Step 2: Run the integration tests and confirm they fail**

Run: `npx vitest run src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js`

Expected: FAIL because `InjectControllerPanel.vue` does not accept `isActive` or render the new `UI 操作` child yet, and `App.vue` does not pass the active-state signal.

- [ ] **Step 3: Wire the new child panel into `InjectControllerPanel.vue` and `App.vue`**

Update the top of `src/inject/panels/InjectControllerPanel.vue`:

```vue
<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';
import InjectUiAutomationPanel from './InjectUiAutomationPanel.vue';

defineOptions({ name: 'InjectControllerPanel' });

const DEFAULT_COMMAND_ARGS_TEXT = '{}';
const MAX_RESPONSE_LOG_ENTRIES = 10;

const props = defineProps({
  isActive: {
    type: Boolean,
    default: false,
  },
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);
```

Add a tiny relay helper near `clearResponseLog()`:

```js
function relayCommandLoadingChange(nextValue) {
  emit('command-loading-change', nextValue);
}
```

Insert the structured UI surface after the metric grid and before the generic command console section:

```vue
    <InjectUiAutomationPanel
      :is-active="props.isActive"
      :command-loading="effectiveCommandLoading"
      :transport-ready="controllerTransportReady"
      :transport-hint="controllerInlineHint"
      @command-loading-change="relayCommandLoadingChange"
    />

    <section class="listing-advice-panel controller-command-panel">
```

In `src/inject/App.vue`, pass the explicit active-state signal into the controller shell:

```vue
        <section
          v-if="renderedPanels.controller"
          v-show="activePanelId === 'controller'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-controller"
          :aria-label="t('inject.controllerTitle')"
        >
          <InjectControllerPanel
            :is-active="activePanelId === 'controller'"
            :command-loading="autoOperationCommandLoading"
            @command-loading-change="setAutoOperationCommandLoading"
          />
        </section>
```

Adjust the `mountPanel()` helper in `src/inject/panels/InjectControllerPanel.test.js` so generic-console tests stay passive by default:

```js
async function mountPanel(props = {}) {
  const wrapper = mount(InjectControllerPanel, {
    attachTo: document.body,
    props: {
      isActive: false,
      commandLoading: '',
      ...props,
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}
```

- [ ] **Step 4: Re-run the integration tests**

Run: `npx vitest run src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js`

Expected: PASS. The controller shell keeps the generic console, the structured `UI 操作` surface only refreshes on active transitions, and reopening the tab reruns the refresh chain without any second `Ping`.

- [ ] **Step 5: Commit the integration task**

```bash
git add src/inject/panels/InjectControllerPanel.vue src/inject/panels/InjectControllerPanel.test.js src/inject/App.vue src/inject/App.test.js
git commit -m "feat: integrate controller ui operations into inject"
```

---

### Task 4: Sync current-state docs and run the final verification chain

**Files:**
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update the current-state documentation**

In `docs/Documentation.md`, replace the current controller bullet:

```md
- `src/inject/panels/InjectControllerPanel.vue` 现在是可用的泛型 controller 工作台：只读显示桌面环境、共享 agent runtime 的桥接可用性/连接状态，复用页级 AutoOperation command lock，并在 `desktop + bridge + connected` 时直接发送任意 `runAutoOperationCommand(command, args)`；它不会在首次挂载时额外触发新的 `Ping`
```

with:

```md
- `src/inject/panels/InjectControllerPanel.vue` 现在同时承载 `UI 操作` 与泛型 command console：前者会在 Controller 首次打开或重新激活时，通过 `GetCurrentUI -> GetVisiblePanels -> DumpPanelTree` 拉取当前主界面、可见 panel 与可交互节点，并允许对 `Button / Toggle / TMP_InputField / NumericInputField` 执行结构化操作；后者继续保留任意 `runAutoOperationCommand(command, args)` 调试入口。整个 Controller 仍复用页级 AutoOperation command lock，且不会在首次挂载时额外触发新的 `Ping`。
```

Then update the workspace-shell summary bullet in the same file:

```md
- `Inject` 页当前由 `src/inject/App.vue` 只负责 workspace 壳层、共享 `collectibles` 加载和跨 panel 的 AutoOperation command lock；展示柜收益 / Agent 状态 / 控制器 / 仓库统计 / 上架建议 / 延迟价格 / 收藏采集都已拆到 `src/inject/panels/*.vue`，只有 `StockMovePanel.vue` 继续保留为一级 panel。`Controller` panel 现在也接入这把共享 command lock，因此不会和 `Agent 状态 / 上架建议 / 延迟价格` 并发发 pipe 命令。
```

to:

```md
- `Inject` 页当前由 `src/inject/App.vue` 只负责 workspace 壳层、共享 `collectibles` 加载和跨 panel 的 AutoOperation command lock；展示柜收益 / Agent 状态 / 控制器 / 仓库统计 / 上架建议 / 延迟价格 / 收藏采集都已拆到 `src/inject/panels/*.vue`，只有 `StockMovePanel.vue` 继续保留为一级 panel。`Controller` panel 内部已拆成 readiness + `UI 操作` child + 泛型 console：`UI 操作` 会在激活时拉当前 UI / 可见 panel / 可交互节点，并与 `Agent 状态 / 上架建议 / 延迟价格` 共用同一把 command lock，因此不会并发发 pipe 命令。
```

In `docs/ARCHITECTURE.md`, replace the current controller summary line:

```md
- `InjectControllerPanel.vue` 当前通过 `src/shared/useAutoOperationAgentSwitch.js` 的无副作用只读视图消费共享 agent runtime，并复用 `App.vue` 提供的 shared AutoOperation command lock；它在 `desktop + bridge + connected` 时可直接发任意 `runAutoOperationCommand(command, args)`，同时仍不会在 panel 首次挂载时自行触发新的 `Ping`。
```

with:

```md
- `InjectControllerPanel.vue` 当前通过 `src/shared/useAutoOperationAgentSwitch.js` 的无副作用只读视图消费共享 agent runtime，并复用 `App.vue` 提供的 shared AutoOperation command lock；shell 本身负责 readiness cards 和泛型 console，新的 `InjectUiAutomationPanel.vue` + `useControllerUiAutomation.js` 负责 `UI 操作` 的激活刷新、panel 切换、节点选择和 click / set-text 动作。整个 Controller 仍不会在 panel 首次挂载时自行触发新的 `Ping`。
```

- [ ] **Step 2: Run the final verification chain**

Run:

```bash
npx vitest run src/inject/panels/useControllerUiAutomation.test.js src/inject/panels/InjectUiAutomationPanel.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js
```

Expected: PASS

Run:

```bash
npx vitest run src/shared/useAutoOperationAgentSwitch.test.js
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

- [ ] **Step 3: Record the fresh verification bullets**

Add these bullets under `## 最新验证` in `docs/Documentation.md`:

```md
- 2026-06-18：`npx vitest run src/inject/panels/useControllerUiAutomation.test.js src/inject/panels/InjectUiAutomationPanel.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js` 通过，覆盖 Controller `UI 操作` 的自动刷新、可见 panel 切换、节点选择、ClickNode / SetInputText 动作、结果截断提示，以及 re-open 触发的二次刷新。
- 2026-06-18：`npx vitest run src/shared/useAutoOperationAgentSwitch.test.js` 通过，说明共享 agent runtime 的被动只读消费仍不会在 Controller `UI 操作` 挂载时额外触发新的 `Ping`。
- 2026-06-18：`npm run build:inject` 通过，说明 `UI 操作` 子面板、Controller shell、Inject 激活链路、i18n 与样式改动可正常构建到 `public/inject/`。
- 2026-06-18：`git diff --check` 无输出，说明本轮 Controller `UI 操作` 面板和 current-state 文档更新未引入空白或补丁格式问题。
```

- [ ] **Step 4: Commit docs and verification**

```bash
git add docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "docs: record controller ui operations current state"
```

---

## Self-Review

- **Spec coverage**
  - `isActive` 贯穿 `App.vue -> InjectControllerPanel.vue -> InjectUiAutomationPanel.vue`：Task 3
  - `GetCurrentUI -> GetVisiblePanels -> DumpPanelTree` 激活刷新链、staged commit、失败不混状态：Task 1
  - 手动刷新保留可见的 `selectedPanel`：Task 1
  - 手动切 panel 只重跑 `DumpPanelTree` 且失败回滚：Task 1
  - 结构化节点列表、详情、click/set-text 动作：Task 2
  - `transport not ready / not refreshed / no visible panels / no interactive nodes` 四类空态：Task 2
  - shared `commandLoading` 从第一条 refresh RPC 持锁到整条链结束：Task 1 + Task 3
  - 文档与最新验证同步：Task 4

- **Placeholder scan**
  - No `TODO`
  - No `TBD`
  - Every code-changing step includes concrete code
  - Every verification step includes an exact command and expected outcome

- **Type / naming consistency**
  - Composable: `useControllerUiAutomation`
  - Child panel: `InjectUiAutomationPanel`
  - Activation prop: `isActive`
  - Structured UI test ids: `controller-ui-*`
  - Lock labels remain internal strings and are not coupled to UI copy
