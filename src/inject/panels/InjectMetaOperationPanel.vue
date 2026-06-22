<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectMetaOperationPanel' });

const ROOM_OPTIONS = [
  { value: '101', label: '快递盲盒堆' },
  { value: '102', label: '废弃仓库' },
  { value: '103', label: '航运集装箱' },
  { value: '104', label: '空置别墅' },
  { value: '105', label: '沉船密封仓' },
  { value: '106', label: '隐秘拍卖会' },
  { value: '304', label: '幽静别墅' },
  { value: '305', label: '深海沉船' },
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
  {
    command: 'ConfirmBid',
    titleKey: 'inject.metaOperationConfirmBid',
  },
  {
    command: 'DismissRewardsBox',
    titleKey: 'inject.metaOperationDismissRewardsBox',
  },
  {
    command: 'DismissCollectAward',
    titleKey: 'inject.metaOperationDismissCollectAward',
  },
  {
    command: 'GetCurrentScreen',
    titleKey: 'inject.metaOperationGetCurrentScreen',
  },
  {
    command: 'CloseCurrentOverlay',
    titleKey: 'inject.metaOperationCloseCurrentOverlay',
  },
  {
    command: 'CollectCabinetReward',
    titleKey: 'inject.metaOperationCollectCabinetReward',
  },
];

const META_OPERATION_LABEL_KEYS = {
  GoToBattlePrev: 'inject.metaOperationGoToBattlePrev',
  EnterRoom: 'inject.metaOperationEnterRoom',
  OpenSkillConfig: 'inject.metaOperationOpenSkillConfig',
  SelectRole: 'inject.metaOperationSelectElsa',
  StartAction: 'inject.metaOperationStartAction',
  GetBidState: 'inject.metaOperationGetBidState',
  PlaceBid: 'inject.metaOperationPlaceBid',
  SetBidAmount: 'inject.metaOperationSetBidAmount',
  ConfirmBid: 'inject.metaOperationConfirmBid',
  DismissRewardsBox: 'inject.metaOperationDismissRewardsBox',
  DismissCollectAward: 'inject.metaOperationDismissCollectAward',
  GetCurrentScreen: 'inject.metaOperationGetCurrentScreen',
  CloseCurrentOverlay: 'inject.metaOperationCloseCurrentOverlay',
  CollectCabinetReward: 'inject.metaOperationCollectCabinetReward',
};

const DEFAULT_AUTO_COLLECT_STATE = {
  enabled: true,
  running: false,
  intervalMs: 10800000,
  nextCheckInMs: null,
  lastCheckAtUnixMs: 0,
  lastResultCode: 'never_run',
  lastResultMessage: '',
  lastObservedScreen: '',
};

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
const bidAmount = ref(100);
const localCommandLoading = ref('');
const panelError = ref('');
const latestCommand = ref('');
const latestResultLabel = ref('');
const latestResultPayload = ref(null);
const autoCollectState = ref({ ...DEFAULT_AUTO_COLLECT_STATE });
const autoCollectLoading = ref(false);
const autoCollectStateLoaded = ref(false);
const autoCollectInitialTransportAttempted = ref(false);

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
const autoCollectStatusText = computed(() => {
  if (autoCollectState.value.running) {
    return t('inject.metaOperationAutoCollectCabinetRewardStatusRunning');
  }
  if (!autoCollectState.value.enabled) {
    return t('inject.metaOperationAutoCollectCabinetRewardDisabled');
  }

  switch (autoCollectState.value.lastResultCode) {
    case 'skipped_not_main_lobby':
      return t('inject.metaOperationAutoCollectCabinetRewardStatusSkippedMainLobby');
    case 'skipped_auto_auction_running':
      return t('inject.metaOperationAutoCollectCabinetRewardStatusSkippedAutoAuction');
    case 'skipped_collect_running':
      return t('inject.metaOperationAutoCollectCabinetRewardStatusSkippedBusy');
    case 'success':
      return t('inject.metaOperationAutoCollectCabinetRewardStatusSuccess');
    case 'failed':
      return t('inject.metaOperationAutoCollectCabinetRewardStatusFailed');
    default:
      return t('inject.metaOperationAutoCollectCabinetRewardStatusNeverRun');
  }
});
const autoCollectEnabledText = computed(() =>
  autoCollectState.value.enabled
    ? t('inject.metaOperationAutoCollectCabinetRewardEnabled')
    : t('inject.metaOperationAutoCollectCabinetRewardDisabled'),
);
const autoCollectToggleDisabled = computed(() =>
  Boolean(!transportReady.value || effectiveCommandLoading.value || autoCollectLoading.value),
);

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
  latestResultLabel.value = t(META_OPERATION_LABEL_KEYS[command] || command);
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

async function loadAutoCollectState() {
  if (
    !transportReady.value ||
    effectiveCommandLoading.value ||
    autoCollectLoading.value ||
    autoCollectStateLoaded.value
  ) {
    return;
  }

  autoCollectLoading.value = true;

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(
      'GetAutoCollectCabinetRewardState',
      {},
    );
    if (response?.value) {
      autoCollectStateLoaded.value = true;
      autoCollectState.value = {
        ...DEFAULT_AUTO_COLLECT_STATE,
        ...response.value,
      };
    }
  } catch {
    // Initial scheduler state is best-effort and should not surface panel errors.
  } finally {
    autoCollectLoading.value = false;
  }
}

async function toggleAutoCollectEnabled(nextEnabled) {
  if (!transportReady.value || effectiveCommandLoading.value) return;

  panelError.value = '';
  localCommandLoading.value = 'SetAutoCollectCabinetRewardEnabled';
  emit('command-loading-change', 'SetAutoCollectCabinetRewardEnabled');

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(
      'SetAutoCollectCabinetRewardEnabled',
      { enabled: nextEnabled },
    );
    if (response?.value) {
      autoCollectStateLoaded.value = true;
      autoCollectState.value = {
        ...DEFAULT_AUTO_COLLECT_STATE,
        ...response.value,
      };
    }
    if (response?.ok === false) {
      panelError.value = response.error || t('inject.failed');
    }
  } catch (error) {
    panelError.value = error?.message || t('inject.failed');
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

async function submitSetBidAmount() {
  await runMetaOperationCommand('SetBidAmount', {
    amount: Number(bidAmount.value),
  });
}

onMounted(async () => {
  await nextTick();
  if (
    transportReady.value &&
    !props.commandLoading &&
    !autoCollectStateLoaded.value &&
    !autoCollectLoading.value
  ) {
    autoCollectInitialTransportAttempted.value = true;
    void loadAutoCollectState();
  }
});

watch(transportReady, (ready, previous) => {
  if (
    ready &&
    !previous &&
    !autoCollectInitialTransportAttempted.value &&
    !props.commandLoading &&
    !autoCollectStateLoaded.value &&
    !autoCollectLoading.value
  ) {
    autoCollectInitialTransportAttempted.value = true;
    void loadAutoCollectState();
  }
});

watch(
  () => props.commandLoading,
  (loading, previous) => {
    if (
      !loading &&
      previous &&
      transportReady.value &&
      !autoCollectStateLoaded.value &&
      !autoCollectLoading.value
    ) {
      void loadAutoCollectState();
    }
  },
);
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

    <article
      class="meta-operation-action-card meta-operation-auto-collect-card"
      data-testid="meta-operation-auto-collect-card"
    >
      <div class="meta-operation-result-head">
        <div>
          <h3>{{ t('inject.metaOperationAutoCollectCabinetReward') }}</h3>
          <p class="status-text is-muted">{{ t('inject.metaOperationAutoCollectCabinetRewardSub') }}</p>
        </div>
        <label class="meta-operation-room-field">
          <input
            :checked="autoCollectState.enabled"
            type="checkbox"
            :disabled="autoCollectToggleDisabled"
            data-testid="meta-operation-auto-collect-toggle"
            @change="toggleAutoCollectEnabled($event.target.checked)"
          />
          <span>{{ autoCollectEnabledText }}</span>
        </label>
      </div>
      <p
        class="status-text"
        data-testid="meta-operation-auto-collect-status"
      >
        {{ autoCollectStatusText }}
      </p>
    </article>

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
        <h3>{{ t('inject.metaOperationSetBidAmount') }}</h3>
        <label class="meta-operation-room-field">
          <span>{{ t('inject.metaOperationBidAmount') }}</span>
          <input
            v-model.number="bidAmount"
            type="number"
            min="0"
            step="1"
            class="meta-operation-room-select"
            :disabled="!canRunMetaOperation"
            data-testid="meta-operation-bid-amount-input"
          />
        </label>
        <button
          class="command-button"
          type="button"
          :disabled="!canRunMetaOperation"
          data-testid="meta-operation-command-SetBidAmount"
          @click="submitSetBidAmount"
        >
          {{ getActionButtonText('SetBidAmount') }}
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
          {{ t('inject.metaOperationLatestCommand') }}: {{ latestResultLabel }} ({{ latestCommand }})
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
