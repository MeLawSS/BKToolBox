<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectCabinetRewardPanel' });

const props = defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const localLoading = ref(false);
const errorMessage = ref('');
const successText = ref('');

const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const agentBridgeAvailable = computed(() => agent.isAvailable.value);
const agentConnected = computed(() => agent.isConnected.value);
const runAutoOperationCommandAvailable = computed(
  () => typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
);
const effectiveCommandLoading = computed(() => props.commandLoading || localLoading.value);

const transportReady = computed(() =>
  Boolean(
    desktopReady.value &&
    agentBridgeAvailable.value &&
    agentConnected.value &&
    runAutoOperationCommandAvailable.value,
  ),
);

const canRunCollect = computed(() =>
  Boolean(transportReady.value && !effectiveCommandLoading.value),
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

async function collectCabinetReward() {
  if (!canRunCollect.value) return;

  errorMessage.value = '';
  successText.value = '';
  localLoading.value = true;
  emit('command-loading-change', 'CollectCabinetReward');

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(
      'CollectCabinetReward',
      {},
    );
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    successText.value = t('inject.claimCabinetRewardSuccess');
  } catch (error) {
    errorMessage.value = error?.message || t('inject.failed');
  } finally {
    localLoading.value = false;
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <header class="section-head">
    <div>
      <h2>{{ t('inject.cabinetReward') }}</h2>
      <p>{{ t('inject.cabinetRewardSub') }}</p>
    </div>
    <div class="action-row">
      <button
        class="primary-button"
        type="button"
        data-testid="cabinet-claim-button"
        :disabled="!canRunCollect"
        @click="collectCabinetReward"
      >
        {{ effectiveCommandLoading ? t('inject.claimingCabinetReward') : t('inject.claimCabinetReward') }}
      </button>
    </div>
  </header>

  <p v-if="!transportReady" class="status-text is-muted">
    {{ transportHintText }}
  </p>
  <p v-else-if="errorMessage" class="status-text is-error">
    {{ errorMessage }}
  </p>
  <p v-else-if="successText" class="status-text">
    {{ successText }}
  </p>
</template>
