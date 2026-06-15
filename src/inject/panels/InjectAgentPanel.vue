<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentSwitch } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectAgentPanel' });

const { t } = useI18n();
const agent = useAutoOperationAgentSwitch();
const props = defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});
const emit = defineEmits(['command-loading-change']);

const autoOperationCommands = [
  'Ping',
  'GetCurrentUI',
  'GetVisiblePanels',
  'OpenPanel',
  'ClosePanel',
  'CollectionPrices',
  'GetWarehouseItemList',
  'GetStockCollectibleCounts',
  'StartDelayedPriceQuery',
  'GetDelayedPriceQueryStatus',
  'CancelDelayedPriceQuery',
  'ExchangeItem',
  'InvokeMethod',
  'UnloadAgent',
];

const autoOperationLoading = agent.isBusy;
const autoOperationInputs = ref({
  panelName: '',
  className: '',
  methodName: '',
  arg0: '',
});
const autoOperationCommandResult = ref(null);
const autoOperationError = ref('');
const sharedAutoOperationError = agent.errorText;

const canStartAutoOperationAgent = agent.isAvailable;

const canRunAutoOperationCommand = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ),
);

const autoOperationStatus = agent.statusText;

const autoOperationCommandResultText = computed(() =>
  autoOperationCommandResult.value
    ? JSON.stringify(autoOperationCommandResult.value.value ?? autoOperationCommandResult.value, null, 2)
    : '',
);

function buildAutoOperationArgs(command) {
  if (command === 'OpenPanel') {
    return { name: autoOperationInputs.value.panelName.trim() };
  }
  if (command === 'InvokeMethod') {
    const args = {
      class: autoOperationInputs.value.className.trim(),
      method: autoOperationInputs.value.methodName.trim(),
    };
    const arg0 = autoOperationInputs.value.arg0.trim();
    if (arg0) args.arg0 = Number(arg0);
    return args;
  }
  return {};
}

async function startAutoOperationAgent() {
  if (!canStartAutoOperationAgent.value || autoOperationLoading.value) return;

  autoOperationError.value = '';

  try {
    await agent.loadAgent();
  } catch (_error) {}
}

async function runAutoOperationCommand(command) {
  if (!canRunAutoOperationCommand.value || props.commandLoading) return;

  const shouldRefreshAgentState = command === 'Ping' || command === 'UnloadAgent';
  emit('command-loading-change', command);
  autoOperationError.value = '';

  try {
    const args = buildAutoOperationArgs(command);
    const response = await window.bidkingDesktop.runAutoOperationCommand(command, args);
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    autoOperationCommandResult.value = response;
  } catch (error) {
    autoOperationError.value = error?.message || t('inject.failed');
  } finally {
    if (shouldRefreshAgentState) {
      await agent.refreshAgentState().catch(() => {});
    }
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <header class="section-head">
    <div>
      <h2>{{ t('inject.autoOperationAgent') }}</h2>
      <p>{{ t('inject.autoOperationAgentSub') }}</p>
    </div>
    <button
      class="primary-button"
      type="button"
      data-testid="auto-op-agent-button"
      :disabled="!canStartAutoOperationAgent || autoOperationLoading"
      @click="startAutoOperationAgent"
    >
      {{ autoOperationLoading ? t('inject.autoOperationStarting') : t('inject.autoOperationStart') }}
    </button>
  </header>

  <p v-if="!canStartAutoOperationAgent" class="status-text is-muted">
    {{ t('inject.unavailable') }}
  </p>
  <p v-else-if="autoOperationError || sharedAutoOperationError" class="status-text is-error">
    {{ autoOperationError || sharedAutoOperationError }}
  </p>

  <div class="metric-grid">
    <div class="metric">
      <span>{{ t('inject.autoOperationStatus') }}</span>
      <strong data-testid="auto-op-agent-status">{{ autoOperationStatus }}</strong>
    </div>
    <div class="metric">
      <span>{{ t('inject.autoOperationPipe') }}</span>
      <strong>\\\\.\\pipe\\BKAutoOp</strong>
    </div>
  </div>

  <div class="auto-op-command-panel">
    <div class="auto-op-fields">
      <label>
        <span>{{ t('inject.autoOperationPanelName') }}</span>
        <input v-model="autoOperationInputs.panelName" type="text" placeholder="TradingExchange_Main" />
      </label>
      <label>
        <span>{{ t('inject.autoOperationClassName') }}</span>
        <input v-model="autoOperationInputs.className" type="text" placeholder="PlayerManager" />
      </label>
      <label>
        <span>{{ t('inject.autoOperationMethodName') }}</span>
        <input v-model="autoOperationInputs.methodName" type="text" placeholder="GetSelfTradeInfo" />
      </label>
      <label>
        <span>{{ t('inject.autoOperationArg0') }}</span>
        <input v-model="autoOperationInputs.arg0" type="number" placeholder="optional" />
      </label>
    </div>

    <div class="command-grid">
      <button
        v-for="command in autoOperationCommands"
        :key="command"
        class="command-button"
        type="button"
        :data-testid="`auto-op-command-${command}`"
        :disabled="!canRunAutoOperationCommand || Boolean(props.commandLoading)"
        @click="runAutoOperationCommand(command)"
      >
        {{ props.commandLoading === command ? t('inject.autoOperationRunning') : command }}
      </button>
    </div>

    <pre
      v-if="autoOperationCommandResultText"
      class="command-result"
      data-testid="auto-op-command-result"
    >{{ autoOperationCommandResultText }}</pre>
  </div>
</template>
