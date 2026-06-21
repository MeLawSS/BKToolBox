# Controller UI Operations Compact Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Inject `Controller` -> `UI 操作` into a compact, list-first operator surface optimized for fast button finding and double-click execution without changing the generic Controller command console or the existing Agent bridge contract.

**Architecture:** Keep `InjectControllerPanel.vue` and `useControllerUiAutomation.js` as the existing shell/runtime boundary, and layer the redesign almost entirely inside `InjectUiAutomationPanel.vue`. The panel should add component-local search/filter state, compact status feedback, transient row highlighting, and a collapsed-by-default detail area on top of the current refresh/selection/action composable instead of inventing a parallel runtime path.

**Tech Stack:** Vue 3 `<script setup>`, existing `useControllerUiAutomation.js` composable, shared `src/shared/messages.js` i18n, `src/inject/inject.css`, `@vue/test-utils`, Vitest, existing preload `runAutoOperationCommand` bridge.

Reference specs:
- `docs/superpowers/specs/2026-06-18-controller-ui-operations-panel-design.md`
- `docs/superpowers/specs/2026-06-18-controller-ui-operations-compact-redesign.md`

---

## File Structure

- **Modify** `src/inject/panels/InjectUiAutomationPanel.vue` - replace the current two-column inspector layout with a compact toolbar + dense full-width node list + collapsed detail area, wire row double-click, and keep fallback click/set-text actions in the detail area.
- **Modify** `src/inject/panels/InjectUiAutomationPanel.test.js` - replace the tall-card / placeholder-oriented assertions with compact-list behavior tests: mapped-label priority, path fallback, single-click selection, double-click click dispatch, non-clickable feedback, search, transient row state, and busy-state gating.
- **Modify** `src/shared/messages.js` - add only the new copy required by the compact surface in both `zh-CN` and `en-US`: search label/placeholder, node-count label, compact status-line text, and collapsed diagnostic summary text.
- **Modify** `src/inject/inject.css` - remove the permanent two-column emphasis for `controller-ui-*`, add dense row styling, transient row success/failure states, compact toolbar/search styling, list scroll bounds (`60vh` desktop / `50vh` narrow), and collapsed detail presentation.
- **Modify** `docs/Documentation.md` - update the current-state `Inject -> Controller -> UI 操作` description and append fresh verification bullets.
- **Modify** `docs/ARCHITECTURE.md` - document that `InjectUiAutomationPanel.vue` now keeps view-local search / transient row feedback while still delegating refresh/action orchestration to `useControllerUiAutomation.js`.

Do **not** change these unless a failing test proves the redesign cannot be delivered otherwise:
- `src/inject/App.vue`
- `src/inject/panels/InjectControllerPanel.vue`
- `src/inject/panels/useControllerUiAutomation.js`

The approved redesign does not require new bridge commands, new Inject panels, or any change to the generic Controller console.

---

### Task 1: Lock the compact operator workflow with failing panel tests

**Files:**
- Modify: `src/inject/panels/InjectUiAutomationPanel.test.js`

- [ ] **Step 1: Rewrite the panel tests around the compact workflow**

Replace the old card/detail assertions with compact-surface coverage in `src/inject/panels/InjectUiAutomationPanel.test.js`:

```js
it('shows mapped labels first and falls back to path for unmapped nodes', async () => {
  const { wrapper } = await mountPanel({
    isActive: true,
    nodeLabelMap: {
      BtnTrade: '主界面.竞拍',
    },
  });

  expect(wrapper.get('[data-testid="controller-ui-node-row-0-label"]').text()).toBe('主界面.竞拍');
  expect(wrapper.get('[data-testid="controller-ui-node-row-0-secondary"]').text()).toBe('BtnTrade');
  expect(wrapper.get('[data-testid="controller-ui-node-row-1-label"]').text()).toBe('InputRoot/PriceInput');
  expect(wrapper.find('[data-testid="controller-ui-node-row-1-secondary"]').exists()).toBe(false);
});

it('keeps the detail area collapsed until a row is selected', async () => {
  const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: true });

  expect(wrapper.find('[data-testid="controller-ui-detail"]').exists()).toBe(false);
  expect(runAutoOperationCommand).not.toHaveBeenCalledWith('ClickNode', expect.anything());

  await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');

  expect(wrapper.get('[data-testid="controller-ui-detail"]').exists()).toBe(true);
  expect(wrapper.get('[data-testid="controller-ui-detail-path"]').text()).toContain('InputRoot/PriceInput');
});

it('filters by mapped label and path, and preserves the search term after refresh', async () => {
  const { wrapper, runAutoOperationCommand } = await mountPanel({
    isActive: true,
    nodeLabelMap: {
      BtnTrade: '主界面.竞拍',
    },
  });

  await wrapper.get('[data-testid="controller-ui-search-input"]').setValue('竞拍');
  expect(wrapper.findAll('[data-testid^="controller-ui-node-row-"]')).toHaveLength(1);
  expect(wrapper.get('[data-testid="controller-ui-node-count"]').text()).toContain('1 / 2');

  await wrapper.get('[data-testid="controller-ui-refresh-button"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.get('[data-testid="controller-ui-search-input"]').element.value).toBe('竞拍');
  expect(wrapper.findAll('[data-testid^="controller-ui-node-row-"]')).toHaveLength(1);
  expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'DumpPanelTree')).toHaveLength(2);

  await wrapper.get('[data-testid="controller-ui-search-input"]').setValue('PriceInput');
  expect(wrapper.findAll('[data-testid^="controller-ui-node-row-"]')).toHaveLength(1);
  expect(wrapper.get('[data-testid="controller-ui-node-row-0-label"]').text()).toBe('InputRoot/PriceInput');
});

it('uses single click only for selection and double click for exactly one ClickNode', async () => {
  const { wrapper, runAutoOperationCommand } = await mountPanel({
    isActive: true,
    nodeLabelMap: {
      BtnTrade: '主界面.竞拍',
    },
  });

  await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).not.toContain('ClickNode');
  expect(wrapper.get('[data-testid="controller-ui-detail"]').exists()).toBe(true);

  await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('dblclick');
  await flushPromises();
  await nextTick();

  const clickCalls = runAutoOperationCommand.mock.calls.filter(([command]) => command === 'ClickNode');
  expect(clickCalls).toHaveLength(1);
  expect(clickCalls[0]).toEqual([
    'ClickNode',
    {
      panel: 'UIMain',
      rootPath: '',
      path: 'BtnTrade',
      pathMode: 'exact',
      component: 'auto',
    },
  ]);
  expect(wrapper.get('[data-testid="controller-ui-status-line"]').text()).toContain('主界面.竞拍');
});

it('surfaces compact non-clickable feedback and clears row-level failure styling after 1.5s', async () => {
  vi.useFakeTimers();
  const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: true });

  await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('dblclick');
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).not.toContain('ClickNode');
  expect(wrapper.get('[data-testid="controller-ui-status-line"]').text()).toContain('不可点击');
  expect(wrapper.get('[data-testid="controller-ui-node-row-1"]').classes()).toContain('is-failure');

  vi.advanceTimersByTime(1500);
  await nextTick();

  expect(wrapper.get('[data-testid="controller-ui-node-row-1"]').classes()).not.toContain('is-failure');
  vi.useRealTimers();
});

it('disables row double click while busy but keeps the search input editable', async () => {
  const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: true });

  await wrapper.setProps({ commandLoading: 'Controller:UI ClickNode' });
  await nextTick();

  await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('dblclick');
  await flushPromises();
  await nextTick();

  expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).not.toContain('ClickNode');

  const searchInput = wrapper.get('[data-testid="controller-ui-search-input"]');
  expect(searchInput.element.disabled).toBe(false);
  await searchInput.setValue('Btn');
  expect(searchInput.element.value).toBe('Btn');
});
```

- [ ] **Step 2: Run the panel tests and confirm the redesign is not implemented yet**

Run:

```bash
npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js
```

Expected: FAIL. The current panel still renders the old tall-card/two-column layout, has no search box, no compact status line, no collapsed detail area, and no row double-click behavior.

---

### Task 2: Implement the compact list-first UI, i18n copy, and row feedback states

**Files:**
- Modify: `src/inject/panels/InjectUiAutomationPanel.vue`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: Replace the panel script/template with the compact interaction model**

Update `src/inject/panels/InjectUiAutomationPanel.vue` so the component keeps local search and row-feedback state while still delegating refresh/panel-switch/click/set-text commands to `useControllerUiAutomation.js`:

```vue
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useControllerUiAutomation } from './useControllerUiAutomation.js';

defineOptions({ name: 'InjectUiAutomationPanel' });

const props = defineProps({
  isActive: { type: Boolean, default: false },
  commandLoading: { type: String, default: '' },
  transportReady: { type: Boolean, default: false },
  transportHint: { type: String, default: '' },
});

const emit = defineEmits(['command-loading-change']);
const { t } = useI18n();

const nodeDisplayLabelMap = ref({});
const searchQuery = ref('');
const statusLineTone = ref('muted');
const statusLineText = ref('');
const lastRowFeedback = ref({ path: '', tone: '' });
let rowFeedbackTimerId = 0;

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

const selectedNodeTypesText = computed(() => {
  if (!selectedNode.value?.componentTypes?.length) {
    return '-';
  }
  return selectedNode.value.componentTypes.join(', ');
});

const actionResultText = computed(() => JSON.stringify({
  action: lastUiActionResult.value?.action,
  panel: lastUiActionResult.value?.panel,
  path: lastUiActionResult.value?.path,
  payload: lastUiActionResult.value?.payload,
}, null, 2));

function formatBoolean(value) {
  return value ? t('inject.controllerBooleanYes') : t('inject.controllerBooleanNo');
}

function handleSelectedPanelChange(event) {
  switchPanel(event?.target?.value || '');
}

function nodeSupportsClick(node) {
  return Array.isArray(node?.componentTypes)
    && (node.componentTypes.includes('Button') || node.componentTypes.includes('Toggle'));
}

function resolveNodeDisplayName(node) {
  const path = String(node?.path || '');
  const mapped = nodeDisplayLabelMap.value[path];
  return typeof mapped === 'string' && mapped.trim() ? mapped.trim() : path;
}

function resolveNodeSecondaryText(node, primaryLabel) {
  return primaryLabel === node.path ? '' : node.path;
}

function resolveNodeTypeBadge(node) {
  return node?.componentTypes?.[0] || '';
}

const displayedInteractiveNodes = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return interactiveNodes.value
    .map((node) => {
      const primaryLabel = resolveNodeDisplayName(node);
      const secondaryLabel = resolveNodeSecondaryText(node, primaryLabel);
      const typeBadge = resolveNodeTypeBadge(node);
      const searchable = `${primaryLabel}\n${node.path}`.toLowerCase();
      return {
        ...node,
        primaryLabel,
        secondaryLabel,
        typeBadge,
        clickable: nodeSupportsClick(node),
        searchable,
      };
    })
    .filter((node) => !query || node.searchable.includes(query));
});

const nodeCountText = computed(() => (
  searchQuery.value.trim()
    ? `${displayedInteractiveNodes.value.length} / ${interactiveNodes.value.length}`
    : String(interactiveNodes.value.length)
));

const listPlaceholderText = computed(() => {
  if (!props.transportReady) return t('inject.controllerUiTransportNotReady');
  if (!hasLoadedUiAutomationOnce.value && !uiAutomationRefreshing.value) return t('inject.controllerNodeListNotRefreshed');
  if (uiAutomationRefreshing.value) return t('inject.controllerNodeListRefreshing');
  if (visiblePanels.value.length === 0) return t('inject.controllerNodeListNoVisiblePanels');
  if (displayedInteractiveNodes.value.length === 0 && interactiveNodes.value.length > 0) return t('inject.controllerSearchNoMatches');
  if (interactiveNodes.value.length === 0) return t('inject.controllerNodeListEmpty');
  return '';
});

function clearRowFeedback() {
  if (rowFeedbackTimerId) {
    clearTimeout(rowFeedbackTimerId);
    rowFeedbackTimerId = 0;
  }
  lastRowFeedback.value = { path: '', tone: '' };
}

function markRowFeedback(path, tone) {
  clearRowFeedback();
  lastRowFeedback.value = { path, tone };
  rowFeedbackTimerId = window.setTimeout(() => {
    lastRowFeedback.value = { path: '', tone: '' };
    rowFeedbackTimerId = 0;
  }, 1500);
}

function setStatusLine(tone, text) {
  statusLineTone.value = tone;
  statusLineText.value = text;
}

function handleNodeRowClick(node) {
  setSelectedNode(node.path);
}

async function handleNodeRowDoubleClick(node) {
  if (!props.transportReady || props.commandLoading) return;

  setSelectedNode(node.path);

  if (!node.clickable) {
    setStatusLine('error', `${node.primaryLabel} · ${t('inject.controllerUiNotClickable')}`);
    markRowFeedback(node.path, 'failure');
    return;
  }

  const ok = await clickSelectedNode();
  if (ok) {
    setStatusLine('success', `${node.primaryLabel} · ${t('inject.controllerUiClickSucceeded')}`);
    markRowFeedback(node.path, 'success');
    return;
  }

  setStatusLine('error', `${node.primaryLabel} · ${uiActionError.value || t('inject.controllerUiClickFailed')}`);
  markRowFeedback(node.path, 'failure');
}

watch([selectedPanel, uiAutomationRefreshing, () => props.isActive], () => {
  clearRowFeedback();
});

async function loadNodeDisplayLabelMap() {
  if (typeof fetch !== 'function') {
    return;
  }

  try {
    const response = await fetch('/data/controller-ui-node-labels.json', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      return;
    }

    nodeDisplayLabelMap.value = Object.fromEntries(
      Object.entries(payload).filter(([path, label]) => (
        typeof path === 'string' &&
        path &&
        typeof label === 'string' &&
        label.trim()
      )),
    );
  } catch (_error) {
    nodeDisplayLabelMap.value = {};
  }
}

onMounted(() => {
  loadNodeDisplayLabelMap();
});

onBeforeUnmount(() => {
  clearRowFeedback();
});
</script>

<template>
  <section class="listing-advice-panel controller-ui-panel" data-testid="controller-ui-operations">
    <header class="section-head controller-ui-head">
      <div>
        <h2>{{ t('inject.controllerUiOperations') }}</h2>
        <p>{{ transportHint }}</p>
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
            :disabled="!canSwitchPanels"
            data-testid="controller-ui-panel-select"
            @change="handleSelectedPanelChange"
          >
            <option v-for="panel in visiblePanels" :key="panel" :value="panel">{{ panel }}</option>
          </select>
        </label>

        <label class="controller-ui-select controller-ui-search">
          <span>{{ t('inject.controllerSearchNodes') }}</span>
          <input
            v-model="searchQuery"
            class="controller-ui-input-field"
            type="text"
            :placeholder="t('inject.controllerSearchNodesPlaceholder')"
            data-testid="controller-ui-search-input"
          />
        </label>

        <div class="controller-ui-summary">
          <span>{{ t('inject.controllerNodeCount') }}</span>
          <strong data-testid="controller-ui-node-count">{{ nodeCountText }}</strong>
        </div>

        <button
          class="command-button"
          type="button"
          :disabled="!canRefreshUi"
          data-testid="controller-ui-refresh-button"
          @click="refreshUi()"
        >
          {{ t('inject.controllerRefreshUi') }}
        </button>
      </div>
    </header>

    <p class="status-text controller-ui-status-line" :class="`is-${statusLineTone}`" data-testid="controller-ui-status-line">
      {{ statusLineText || props.transportHint }}
    </p>
    <p v-if="uiAutomationError" class="status-text is-error" data-testid="controller-ui-error">{{ uiAutomationError }}</p>
    <p v-if="nodeListTruncated" class="status-text" data-testid="controller-ui-truncated">{{ t('inject.controllerNodeListTruncated') }}</p>

    <div class="controller-ui-body">
      <section class="controller-ui-list-shell">
        <div v-if="listPlaceholderText" class="controller-ui-placeholder" data-testid="controller-ui-list-placeholder">
          {{ listPlaceholderText }}
        </div>

        <div v-else class="controller-ui-node-list" data-testid="controller-ui-node-list">
          <button
            v-for="(node, index) in displayedInteractiveNodes"
            :key="`${node.path}::${index}`"
            class="controller-ui-node-button"
            :class="{
              'is-selected': node.path === selectedNodePath,
              'is-actionable': node.clickable,
              'is-success': lastRowFeedback.path === node.path && lastRowFeedback.tone === 'success',
              'is-failure': lastRowFeedback.path === node.path && lastRowFeedback.tone === 'failure',
            }"
            type="button"
            :data-testid="`controller-ui-node-row-${index}`"
            @click="handleNodeRowClick(node)"
            @dblclick="handleNodeRowDoubleClick(node)"
          >
            <strong :data-testid="`controller-ui-node-row-${index}-label`">{{ node.primaryLabel }}</strong>
            <code v-if="node.secondaryLabel" :data-testid="`controller-ui-node-row-${index}-secondary`">{{ node.secondaryLabel }}</code>
            <span v-if="node.typeBadge" class="controller-ui-node-badge">{{ node.typeBadge }}</span>
          </button>
        </div>
      </section>

      <section v-if="selectedNode" class="controller-ui-detail-card" data-testid="controller-ui-detail">
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

        <p v-if="uiActionError" class="status-text is-error" data-testid="controller-ui-action-error">{{ uiActionError }}</p>

        <div class="controller-ui-actions">
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
              <input v-model="nodeSubmitAfterInput" type="checkbox" data-testid="controller-ui-submit-toggle" />
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

        <details v-if="lastUiActionResult" class="controller-ui-diagnostics" data-testid="controller-ui-action-diagnostics">
          <summary>{{ t('inject.controllerUiActionDetails') }}</summary>
          <pre class="command-result" data-testid="controller-ui-action-result">{{ actionResultText }}</pre>
        </details>
      </section>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Add the new compact-surface copy in both locales**

Extend the `inject` section in `src/shared/messages.js` for both `zh-CN` and `en-US`:

```js
controllerSearchNodes: '搜索节点',
controllerSearchNodesPlaceholder: '按名称或路径过滤',
controllerNodeCount: '节点数',
controllerSearchNoMatches: '当前搜索没有匹配节点。',
controllerUiNotClickable: '不可点击',
controllerUiClickSucceeded: '已点击',
controllerUiClickFailed: '点击失败',
controllerUiActionDetails: '最近操作详情',
```

```js
controllerSearchNodes: 'Search nodes',
controllerSearchNodesPlaceholder: 'Filter by label or path',
controllerNodeCount: 'Nodes',
controllerSearchNoMatches: 'No nodes match the current filter.',
controllerUiNotClickable: 'Not clickable',
controllerUiClickSucceeded: 'Clicked',
controllerUiClickFailed: 'Click failed',
controllerUiActionDetails: 'Latest action details',
```

Do not rename the existing `inject.controllerUiOperations`, `inject.controllerRefreshUi`, `inject.controllerNodeListTruncated`, or `inject.controllerSetTextAction` keys; the redesign should build on the current namespace instead of inventing a new one.

- [ ] **Step 3: Replace the old two-column styling with dense list styling**

Update the `controller-ui-*` block in `src/inject/inject.css`:

```css
.controller-ui-panel {
  gap: 12px;
}

.controller-ui-toolbar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, max-content));
  align-items: end;
  gap: 8px;
}

.controller-ui-search {
  min-width: min(280px, 100%);
}

.controller-ui-status-line {
  min-height: 18px;
  font-size: 12px;
}

.controller-ui-status-line.is-success {
  color: #2f8f83;
}

.controller-ui-body {
  display: grid;
  gap: 10px;
}

.controller-ui-list-shell,
.controller-ui-detail-card,
.controller-ui-detail-grid {
  display: grid;
  gap: 10px;
}

.controller-ui-node-list {
  display: grid;
  gap: 6px;
  max-height: 60vh;
  overflow: auto;
  padding-right: 4px;
}

.controller-ui-node-button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.controller-ui-node-button strong,
.controller-ui-node-button code {
  min-width: 0;
}

.controller-ui-node-button code {
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controller-ui-node-badge {
  justify-self: end;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
  font-size: 11px;
}

.controller-ui-node-button.is-selected {
  border-color: rgba(57, 168, 149, 0.6);
  background: rgba(47, 143, 131, 0.12);
}

.controller-ui-node-button.is-success {
  border-color: rgba(57, 168, 149, 0.7);
}

.controller-ui-node-button.is-failure {
  border-color: rgba(205, 92, 92, 0.7);
}

.controller-ui-detail-card {
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--surface);
}

.controller-ui-diagnostics summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 760px) {
  .controller-ui-toolbar {
    grid-template-columns: 1fr;
  }

  .controller-ui-node-list {
    max-height: 50vh;
  }
}
```

The important behavior change is structural, not cosmetic: the list must stay full-width, scroll inside itself, and no permanent right-side detail column may remain.

- [ ] **Step 4: Re-run the focused panel tests**

Run:

```bash
npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js
```

Expected: PASS. The panel now renders mapped labels first, falls back to path, keeps the detail area hidden until selection, supports search, uses double-click for click dispatch, and shows transient row feedback.

- [ ] **Step 5: Commit the compact-surface code**

```bash
git add src/inject/panels/InjectUiAutomationPanel.vue src/inject/panels/InjectUiAutomationPanel.test.js src/shared/messages.js src/inject/inject.css
git commit -m "feat: redesign controller ui operations for fast clicking"
```

---

### Task 3: Sync current-state docs and run the verification chain

**Files:**
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update the current-state documentation**

In `docs/Documentation.md`, replace the current `Inject -> Controller` bullet with:

```md
- `src/inject/panels/InjectControllerPanel.vue` 现在同时承载 `UI 操作` 和泛型 command console：它先只读显示桌面环境、共享 agent runtime 的桥接可用性/连接状态；`UI 操作` 会通过 `GetCurrentUI -> GetVisiblePanels -> DumpPanelTree` 刷新当前 UI，并以“搜索 + 紧凑节点列表 + 双击按钮行直接点击 + 按需展开详情区”的 operator-first 形态提供结构化操作；command console 在 `desktop + bridge + connected` 时仍可直接发送任意 `runAutoOperationCommand(command, args)`；两者都复用页级 AutoOperation command lock，且 Controller 首次挂载时仍不会额外触发新的 `Ping`
```

In `docs/ARCHITECTURE.md`, replace the current Controller/UI-operations paragraph with:

```md
- `InjectControllerPanel.vue` 当前通过 `src/shared/useAutoOperationAgentSwitch.js` 的无副作用只读视图消费共享 agent runtime，并作为 readiness cards + 泛型 command console 的外层壳；`src/inject/App.vue` 会按 `activePanelId === 'controller'` 显式传入 `isActive`，`InjectControllerPanel.vue` 再把该信号转交给 `InjectUiAutomationPanel.vue` + `useControllerUiAutomation.js`。后者继续负责 activation refresh、visible panel 切换、node 选择，以及 `ClickNode / SetInputText` 结构化动作；而 `InjectUiAutomationPanel.vue` 现在额外保留 view-local 的 search/filter、双击行点击、compact status line 和 1.5s transient row feedback，因此 UI 体验可以重做，但 bridge / refresh / shared lock 语义仍集中在 composable 里。
```

- [ ] **Step 2: Record the fresh verification bullets**

Append these bullets under `## 最新验证` in `docs/Documentation.md`:

```md
- 2026-06-19：`npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js src/inject/panels/useControllerUiAutomation.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js` 通过；覆盖 `Controller -> UI 操作` 的紧凑搜索列表、mapped label/path fallback、single-click 只选中、double-click 触发 `ClickNode`、non-clickable 行反馈、shared command lock busy gating，以及既有 activation refresh / panel reopen / structured action 链路未回归。
- 2026-06-19：`npm run build:inject` 通过；说明 compact redesign 后的 `UI 操作` 子面板、i18n 与样式改动可正常构建到 `public/inject/`。
- 2026-06-19：`git diff --check` 无输出，说明本轮 `Controller UI 操作` 紧凑化改动与文档同步未引入空白或补丁格式问题。
```

- [ ] **Step 3: Run the verification chain**

Run:

```bash
npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js src/inject/panels/useControllerUiAutomation.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js
```

Expected: PASS. The redesigned child panel passes its new compact-workflow tests, and the existing composable/controller/app integration tests remain green.

Run:

```bash
npm run build:inject
```

Expected: PASS and write the rebuilt Inject bundle to `public/inject/`.

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit the docs and verification updates**

`docs/` is ignored in this repo, so force-add the doc changes:

```bash
git add -f docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "docs: sync compact controller ui operations"
```

---

## Self-Review

- **Spec coverage**
  - full-width dense list replacing the permanent list/detail split: Task 2
  - mapped label first, path fallback second: Task 1 + Task 2
  - single click selects only: Task 1 + Task 2
  - double click dispatches `ClickNode` with the full required argument set: Task 1 + Task 2
  - non-clickable feedback: Task 1 + Task 2
  - search by mapped label and path, preserved across refresh: Task 1 + Task 2
  - detail area collapsed until selection: Task 1 + Task 2
  - transient row success/failure feedback lasting `1.5s`: Task 1 + Task 2
  - shared command lock continues gating refresh/panel switch/actions: Task 1 + Task 3
  - current-state docs and verification bullets stay in sync: Task 3

- **Placeholder scan**
  - No `TODO` / `TBD`
  - Every file path is explicit
  - Every code-changing step includes concrete code
  - Every verification step includes an exact command and expected result

- **Type / naming consistency**
  - child component remains `InjectUiAutomationPanel.vue`
  - runtime orchestration remains `useControllerUiAutomation.js`
  - compact-surface test ids stay under the `controller-ui-*` namespace
  - double-click still routes through the existing `ClickNode` bridge contract instead of inventing a second click API
