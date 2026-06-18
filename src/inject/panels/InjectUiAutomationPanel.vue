<script setup>
import { computed, onMounted, ref, toRef } from 'vue';
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
const nodeDisplayLabelMap = ref({});

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

const displayedInteractiveNodes = computed(() => (
  interactiveNodes.value.map((node) => ({
    ...node,
    displayName: resolveNodeDisplayName(node),
  }))
));

const selectedNodeTypesText = computed(() => {
  if (!selectedNode.value?.componentTypes?.length) {
    return '-';
  }
  return selectedNode.value.componentTypes.join(', ');
});

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

const detailPlaceholderText = computed(() => {
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
  if (!selectedNode.value) {
    return t('inject.controllerNoSelectedNode');
  }
  return '';
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

function resolveNodeDisplayName(node) {
  const path = String(node?.path || '');
  const mappedLabel = nodeDisplayLabelMap.value[path];
  if (typeof mappedLabel === 'string' && mappedLabel.trim()) {
    return mappedLabel.trim();
  }
  return String(node?.name || path);
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
          @click="refreshUi()"
        >
          {{ t('inject.controllerRefreshUi') }}
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
          v-if="listPlaceholderText"
          class="controller-ui-placeholder"
          data-testid="controller-ui-list-placeholder"
        >
          {{ listPlaceholderText }}
        </div>
        <div v-else class="controller-ui-node-list">
          <button
            v-for="(node, index) in displayedInteractiveNodes"
            :key="node.path"
            class="controller-ui-node-button"
            :class="{ 'is-selected': node.path === selectedNodePath }"
            type="button"
            :data-testid="`controller-ui-node-row-${index}`"
            @click="setSelectedNode(node.path)"
          >
            <strong>{{ node.displayName }}</strong>
            <code>{{ node.path }}</code>
            <span class="controller-ui-node-meta">{{ node.componentTypes.join(', ') }}</span>
          </button>
        </div>
      </section>

      <section class="controller-ui-column">
        <h3>{{ t('inject.controllerNodeDetails') }}</h3>
        <div
          v-if="detailPlaceholderText"
          class="controller-ui-placeholder"
          data-testid="controller-ui-detail-placeholder"
        >
          {{ detailPlaceholderText }}
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

          <template v-if="lastUiActionResult">
            <strong
              class="controller-ui-result-label"
              data-testid="controller-ui-action-result-label"
            >
              {{ t('inject.controllerUiActionResult') }}
            </strong>
            <pre
              class="command-result"
              data-testid="controller-ui-action-result"
            >{{ actionResultText }}</pre>
          </template>
        </template>
      </section>
    </div>
  </section>
</template>
