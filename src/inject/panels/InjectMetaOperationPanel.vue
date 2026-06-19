<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectMetaOperationPanel' });

const ROOM_OPTIONS = [
  { value: '101', label: '101 快递盲盒堆' },
  { value: '102', label: '102 废弃仓库' },
  { value: '103', label: '103 航运集装箱' },
  { value: '104', label: '104 空置别墅' },
  { value: '105', label: '105 沉船密封仓' },
  { value: '106', label: '106 隐秘拍卖会' },
  { value: '304', label: '304 幽静别墅' },
  { value: '305', label: '305 深海沉船' },
];

const ZERO_ARG_ACTIONS = [
  {
    command: 'GoToBattlePrev',
    titleKey: 'inject.metaOperationGoToBattlePrev',
  },
  {
    command: 'OpenSkillConfig',
    titleKey: 'inject.metaOperationOpenSkillConfig',
  },
  {
    command: 'SelectRole',
    titleKey: 'inject.metaOperationSelectElsa',
  },
  {
    command: 'StartAction',
    titleKey: 'inject.metaOperationStartAction',
  },
  {
    command: 'GetBidState',
    titleKey: 'inject.metaOperationGetBidState',
  },
  {
    command: 'PlaceBid',
    titleKey: 'inject.metaOperationPlaceBid',
  },
];

const props = defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const selectedRoomId = ref('101');
const localCommandLoading = ref('');
const panelError = ref('');
const latestCommand = ref('');
const latestResultPayload = ref(null);

const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const agentBridgeAvailable = computed(() => agent.isAvailable.value);
const agentConnected = computed(() => agent.isConnected.value);
const agentStatusText = computed(() => agent.statusText.value);
const runAutoOperationCommandAvailable = computed(
  () => typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
);
const effectiveCommandLoading = computed(() => props.commandLoading || localCommandLoading.value);

const transportReady = computed(() =>
  Boolean(
    desktopReady.value &&
    agentBridgeAvailable.value &&
    agentConnected.value &&
    runAutoOperationCommandAvailable.value,
  ),
);

const canRunMetaOperation = computed(() =>
  Boolean(transportReady.value && !effectiveCommandLoading.value),
);

const latestResultText = computed(() =>
  latestResultPayload.value ? JSON.stringify(latestResultPayload.value, null, 2) : '',
);

const hasLatestResult = computed(() => latestResultPayload.value !== null);

const transportHintText = computed(() => {
  if (!desktopReady.value) return t('inject.unavailable');
  if (!agentBridgeAvailable.value || !runAutoOperationCommandAvailable.value) {
    return t('inject.metaOperationTransportHint');
  }
  if (!agentConnected.value) return t('inject.controllerAgentDisconnectedHint');
  if (effectiveCommandLoading.value) return t('inject.controllerBusyHint');
  return t('inject.metaOperationReadyHint');
});

function formatAvailability(value) {
  return value ? t('inject.controllerAvailable') : t('inject.controllerUnavailable');
}

function getActionButtonText(command) {
  return effectiveCommandLoading.value === command
    ? t('inject.metaOperationRunning')
    : t('inject.metaOperationExecute');
}

async function runMetaOperationCommand(command, args = {}) {
  if (!canRunMetaOperation.value) return;

  panelError.value = '';
  latestCommand.value = command;
  localCommandLoading.value = command;
  emit('command-loading-change', command);

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(command, args);
    latestResultPayload.value = response;
    if (response?.ok === false) {
      panelError.value = response.error || t('inject.failed');
    }
  } catch (error) {
    const message = error?.message || t('inject.failed');
    panelError.value = message;
    latestResultPayload.value = {
      ok: false,
      error: message,
    };
  } finally {
    localCommandLoading.value = '';
    emit('command-loading-change', '');
  }
}

async function submitEnterRoom() {
  await runMetaOperationCommand('EnterRoom', {
    roomId: Number(selectedRoomId.value),
  });
}
</script>

<template>
  <section class="listing-advice-panel meta-operation-panel" data-testid="meta-operation-panel">
    <header class="section-head meta-operation-head">
      <div>
        <h2 data-testid="meta-operation-title">{{ t('inject.metaOperationTitle') }}</h2>
        <p>{{ t('inject.metaOperationSubtitle') }}</p>
      </div>
    </header>

    <div class="meta-operation-status-grid">
      <div class="meta-operation-status-item" data-testid="meta-operation-status-desktop">
        <span>{{ t('inject.metaOperationDesktop') }}</span>
        <strong>{{ formatAvailability(desktopReady) }}</strong>
      </div>
      <div class="meta-operation-status-item" data-testid="meta-operation-status-agentBridge">
        <span>{{ t('inject.metaOperationAgentBridge') }}</span>
        <strong>{{ formatAvailability(agentBridgeAvailable) }}</strong>
      </div>
      <div class="meta-operation-status-item" data-testid="meta-operation-status-agentConnection">
        <span>{{ t('inject.metaOperationAgentConnection') }}</span>
        <strong>{{ agentStatusText }}</strong>
      </div>
    </div>

    <p class="status-text meta-operation-transport-hint" data-testid="meta-operation-transport-hint">
      {{ transportHintText }}
    </p>

    <div class="meta-operation-action-grid">
      <article
        v-for="action in ZERO_ARG_ACTIONS"
        :key="action.command"
        class="meta-operation-action-card"
        :data-testid="`meta-operation-card-${action.command}`"
      >
        <h3>{{ t(action.titleKey) }}</h3>
        <button
          class="command-button"
          type="button"
          :disabled="!canRunMetaOperation"
          :data-testid="`meta-operation-command-${action.command}`"
          @click="runMetaOperationCommand(action.command)"
        >
          {{ getActionButtonText(action.command) }}
        </button>
      </article>

      <article class="meta-operation-action-card meta-operation-room-card">
        <h3>{{ t('inject.metaOperationEnterRoom') }}</h3>
        <label class="meta-operation-room-field">
          <span>{{ t('inject.metaOperationRoom') }}</span>
          <select
            v-model="selectedRoomId"
            class="meta-operation-room-select"
            :disabled="!canRunMetaOperation"
            data-testid="meta-operation-room-select"
          >
            <option v-for="room in ROOM_OPTIONS" :key="room.value" :value="room.value">
              {{ room.label }}
            </option>
          </select>
        </label>
        <button
          class="command-button"
          type="button"
          :disabled="!canRunMetaOperation"
          data-testid="meta-operation-command-EnterRoom"
          @click="submitEnterRoom"
        >
          {{ getActionButtonText('EnterRoom') }}
        </button>
      </article>
    </div>

    <section class="meta-operation-result-panel" data-testid="meta-operation-latest-result">
      <header class="meta-operation-result-head">
        <h3>{{ t('inject.metaOperationLatestResult') }}</h3>
        <span
          v-if="latestCommand"
          class="status-text is-muted"
          data-testid="meta-operation-latest-command"
        >
          {{ t('inject.metaOperationLatestCommand') }}: {{ latestCommand }}
        </span>
      </header>

      <p v-if="panelError" class="status-text is-error" data-testid="meta-operation-error">
        {{ panelError }}
      </p>

      <p
        v-if="!hasLatestResult"
        class="status-text is-muted"
        data-testid="meta-operation-latest-result-empty"
      >
        {{ t('inject.metaOperationNoResult') }}
      </p>
      <pre
        v-else
        class="command-result meta-operation-result-json"
        data-testid="meta-operation-latest-result-payload"
      >{{ latestResultText }}</pre>
    </section>
  </section>
</template>
