<script setup>
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import {
  nodeSupportsClick,
  nodeSupportsTextInput,
  useControllerUiAutomation,
} from './useControllerUiAutomation.js';

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
const nodeDisplayLabelMap = ref({});
const searchQuery = ref('');
const lastRowFeedback = ref(null);
let rowFeedbackTimer = 0;

const {
  uiAutomationRefreshing,
  currentMainPanel,
  visiblePanels,
  selectedPanel,
  interactiveNodes,
  selectedNodePath,
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
} = useControllerUiAutomation({
  isActive: toRef(props, 'isActive'),
  transportReady: toRef(props, 'transportReady'),
  commandLoading: toRef(props, 'commandLoading'),
  emitCommandLoadingChange(value) {
    emit('command-loading-change', value);
  },
});

const displayedInteractiveNodes = computed(() => {
  const normalizedQuery = searchQuery.value.trim().toLowerCase();

  return interactiveNodes.value
    .map((node) => ({
      ...node,
      displayName: resolveNodeDisplayName(node),
    }))
    .filter((node) => {
      if (!normalizedQuery) {
        return true;
      }

      return (
        node.displayName.toLowerCase().includes(normalizedQuery) ||
        node.path.toLowerCase().includes(normalizedQuery)
      );
    });
});

const displayedSelectedNode = computed(() => (
  displayedInteractiveNodes.value.find((node) => node.path === selectedNodePath.value) || null
));

const selectedNodeTypesText = computed(() => {
  if (!displayedSelectedNode.value?.componentTypes?.length) {
    return '-';
  }
  return displayedSelectedNode.value.componentTypes.join(', ');
});

const displayedSelectedNodeSupportsClick = computed(() => (
  nodeSupportsClick(displayedSelectedNode.value)
));

const displayedSelectedNodeSupportsTextInput = computed(() => (
  nodeSupportsTextInput(displayedSelectedNode.value)
));

const canRunDisplayedClickAction = computed(() => Boolean(
  displayedSelectedNode.value && canRunClickAction.value
));

const canRunDisplayedSetTextAction = computed(() => Boolean(
  displayedSelectedNode.value && canRunSetTextAction.value
));

const listPlaceholderText = computed(() => {
  if (!props.transportReady) {
    return t('inject.controllerUiTransportNotReady');
  }
  if (!hasLoadedUiAutomationOnce.value && !uiAutomationRefreshing.value) {
    return t('inject.controllerNodeListNotRefreshed');
  }
  if (uiAutomationRefreshing.value) {
    return t('inject.controllerNodeListRefreshing');
  }
  if (visiblePanels.value.length === 0) {
    return t('inject.controllerNodeListNoVisiblePanels');
  }
  if (interactiveNodes.value.length === 0) {
    return t('inject.controllerNodeListEmpty');
  }
  return '';
});

const compactStatus = computed(() => {
  if (uiAutomationError.value) {
    return {
      tone: 'error',
      text: uiAutomationError.value,
    };
  }

  if (uiActionError.value) {
    return {
      tone: 'error',
      text: uiActionError.value,
    };
  }

  if (effectiveCommandLoading.value) {
    return {
      tone: 'info',
      text: effectiveCommandLoading.value,
    };
  }

  if (nodeListTruncated.value) {
    return {
      tone: 'warning',
      text: t('inject.controllerNodeListTruncated'),
    };
  }

  if (lastUiActionResult.value) {
    return {
      tone: 'success',
      text: t('inject.controllerUiActionSucceeded', {
        action: lastUiActionResult.value.action,
        path: lastUiActionResult.value.path,
      }),
    };
  }

  return null;
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

async function handleSelectedPanelChange(event) {
  const didSwitch = await switchPanel(event?.target?.value || '');
  if (didSwitch) {
    clearRowFeedback();
  }
}

function resolveNodeDisplayName(node) {
  const path = String(node?.path || '');
  const mappedLabel = nodeDisplayLabelMap.value[path];
  if (typeof mappedLabel === 'string' && mappedLabel.trim()) {
    return mappedLabel.trim();
  }
  return path;
}

function clearRowFeedback() {
  if (rowFeedbackTimer) {
    window.clearTimeout(rowFeedbackTimer);
    rowFeedbackTimer = 0;
  }
  lastRowFeedback.value = null;
}

function setRowFeedback(path, tone) {
  clearRowFeedback();
  lastRowFeedback.value = {
    path,
    tone,
  };
  rowFeedbackTimer = window.setTimeout(() => {
    lastRowFeedback.value = null;
    rowFeedbackTimer = 0;
  }, 1500);
}

function rowFeedbackClass(path) {
  if (lastRowFeedback.value?.path !== path) {
    return '';
  }
  return `is-${lastRowFeedback.value.tone}`;
}

async function handleNodeDoubleClick(node) {
  if (effectiveCommandLoading.value) {
    return;
  }

  setSelectedNode(node.path);

  if (!nodeSupportsClick(node)) {
    uiActionError.value = t('inject.controllerNodeNotClickable');
    setRowFeedback(node.path, 'blocked');
    return;
  }

  const didClick = await clickSelectedNode();
  setRowFeedback(node.path, didClick ? 'success' : 'error');
}

async function handleRefreshClick() {
  const didRefresh = await refreshUi();
  if (didRefresh) {
    clearRowFeedback();
  }
}

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

watch(
  () => props.isActive,
  (isActive) => {
    if (!isActive) {
      clearRowFeedback();
    }
  },
);

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
            <option
              v-for="panel in visiblePanels"
              :key="panel"
              :value="panel"
            >
              {{ panel }}
            </option>
          </select>
        </label>
        <button
          class="command-button"
          type="button"
          :disabled="!canRefreshUi"
          data-testid="controller-ui-refresh-button"
          @click="handleRefreshClick"
        >
          {{ t('inject.controllerRefreshUi') }}
        </button>
      </div>
    </header>

    <p
      v-if="compactStatus"
      class="controller-ui-status"
      :class="`is-${compactStatus.tone}`"
      :data-testid="compactStatus.tone === 'error' ? 'controller-ui-action-error' : 'controller-ui-status'"
    >
      {{ compactStatus.text }}
    </p>

    <div class="controller-ui-body">
      <section class="controller-ui-list-section">
        <div class="controller-ui-list-head">
          <h3>{{ t('inject.controllerInteractiveNodes') }}</h3>
          <label class="controller-ui-select controller-ui-search">
            <span>{{ t('inject.controllerNodeSearch') }}</span>
            <input
              v-model="searchQuery"
              class="controller-ui-input-field"
              type="search"
              data-testid="controller-ui-search-input"
              :placeholder="t('inject.controllerNodeSearchPlaceholder')"
            />
          </label>
        </div>
        <div
          v-if="listPlaceholderText"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ listPlaceholderText }}
        </div>
        <div v-else-if="displayedInteractiveNodes.length" class="controller-ui-node-list">
          <button
            v-for="(node, index) in displayedInteractiveNodes"
            :key="node.path"
            class="controller-ui-node-button"
            :class="[
              { 'is-selected': node.path === selectedNodePath },
              rowFeedbackClass(node.path),
            ]"
            type="button"
            :data-testid="`controller-ui-node-row-${index}`"
            @click="setSelectedNode(node.path)"
            @dblclick="handleNodeDoubleClick(node)"
          >
            <strong>{{ node.displayName }}</strong>
            <code>{{ node.path }}</code>
            <span class="controller-ui-node-meta">{{ node.componentTypes.join(', ') }}</span>
          </button>
        </div>
        <div
          v-else
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ t('inject.controllerNodeSearchEmpty') }}
        </div>
      </section>

      <section
        v-if="displayedSelectedNode"
        class="controller-ui-detail-section"
      >
        <h3>{{ t('inject.controllerNodeDetails') }}</h3>
        <div class="controller-ui-detail-grid">
          <div>
            <span>{{ t('inject.controllerSelectedPanel') }}</span>
            <strong>{{ selectedPanel }}</strong>
          </div>
          <div data-testid="controller-ui-detail-path">
            <span>{{ t('inject.controllerNodePath') }}</span>
            <strong>{{ displayedSelectedNode.path }}</strong>
          </div>
          <div data-testid="controller-ui-detail-types">
            <span>{{ t('inject.controllerNodeTypes') }}</span>
            <strong>{{ selectedNodeTypesText }}</strong>
          </div>
          <div>
            <span>{{ t('inject.controllerNodeActive') }}</span>
            <strong>{{ formatBoolean(displayedSelectedNode.active) }}</strong>
          </div>
          <div>
            <span>{{ t('inject.controllerNodeInteractive') }}</span>
            <strong>{{ formatBoolean(displayedSelectedNode.interactive) }}</strong>
          </div>
        </div>

        <div class="controller-ui-actions">
          <div class="controller-ui-detail-actions">
            <button
              v-if="displayedSelectedNodeSupportsClick"
              class="command-button"
              type="button"
              :disabled="!canRunDisplayedClickAction"
              data-testid="controller-ui-click-button"
              @click="clickSelectedNode"
            >
              {{ t('inject.controllerClickAction') }}
            </button>
          </div>

          <template v-if="displayedSelectedNodeSupportsTextInput">
            <label class="controller-ui-select">
              <span>{{ t('inject.controllerSetTextAction') }}</span>
              <input
                v-model="nodeInputDraft"
                class="controller-ui-input-field"
                type="text"
                data-testid="controller-ui-input-draft"
              />
            </label>
            <label class="controller-ui-checkbox">
              <input
                v-model="nodeSubmitAfterInput"
                type="checkbox"
                data-testid="controller-ui-submit-toggle"
              />
              <span>{{ t('inject.controllerSubmitAfterSetText') }}</span>
            </label>
            <button
              class="command-button"
              type="button"
              :disabled="!canRunDisplayedSetTextAction"
              data-testid="controller-ui-set-text-button"
              @click="setSelectedNodeText"
            >
              {{ t('inject.controllerSetTextAction') }}
            </button>
          </template>
        </div>

        <details
          v-if="lastUiActionResult"
          class="controller-ui-diagnostics"
        >
          <summary class="controller-ui-result-label">
            {{ t('inject.controllerUiActionResult') }}
          </summary>
          <pre
            class="command-result"
            data-testid="controller-ui-action-result"
          >{{ actionResultText }}</pre>
        </details>
      </section>
    </div>
  </section>
</template>
