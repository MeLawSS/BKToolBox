<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectDelayedPricePanel' });

const props = defineProps({
  collectibles: {
    type: Array,
    default: () => [],
  },
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();

const selectedDelayedPriceItem = ref(null);
const delayedPriceInputs = ref({
  query: '',
  delaySeconds: '600',
  jitterSeconds: '90',
});
const delayedPriceTask = ref(null);
const delayedPriceError = ref('');

const canRunAutoOperationCommand = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ),
);

const delayedPriceItemCid = computed(() => {
  const query = delayedPriceInputs.value.query.trim();
  if (/^\d+$/.test(query)) return Number(query);
  return selectedDelayedPriceItem.value?.itemCid ? Number(selectedDelayedPriceItem.value.itemCid) : 0;
});

const delayedPriceDelaySeconds = computed(() => Number(delayedPriceInputs.value.delaySeconds));
const delayedPriceJitterSeconds = computed(() => Number(delayedPriceInputs.value.jitterSeconds));

const delayedPriceWindow = computed(() => {
  const delay = delayedPriceDelaySeconds.value;
  const jitter = delayedPriceJitterSeconds.value;
  if (!Number.isFinite(delay) || !Number.isFinite(jitter) || delay <= 0 || jitter < 0) return '-';
  return `${Math.max(1, delay - jitter)}s - ${delay + jitter}s`;
});

const delayedPriceCandidates = computed(() => {
  const query = delayedPriceInputs.value.query.trim().toLowerCase();
  if (!query || /^\d+$/.test(query)) return [];

  return props.collectibles
    .filter((item) => [
      item.name,
      item.quality,
      item.type,
      String(item.itemCid),
    ].some((value) => String(value || '').toLowerCase().includes(query)))
    .slice(0, 8);
});

const canStartDelayedPriceQuery = computed(() =>
  Boolean(
    canRunAutoOperationCommand.value &&
    !props.commandLoading &&
    delayedPriceItemCid.value > 0 &&
    delayedPriceDelaySeconds.value > 0 &&
    delayedPriceJitterSeconds.value >= 0 &&
    delayedPriceJitterSeconds.value <= delayedPriceDelaySeconds.value,
  ),
);

const canCancelDelayedPriceQuery = computed(() =>
  Boolean(
    canRunAutoOperationCommand.value &&
    !props.commandLoading &&
    delayedPriceTask.value?.taskId &&
    ['scheduled', 'running'].includes(String(delayedPriceTask.value?.state || '')),
  ),
);

function clearSelectedDelayedPriceItem() {
  selectedDelayedPriceItem.value = null;
  delayedPriceError.value = '';
}

function selectDelayedPriceItem(item) {
  selectedDelayedPriceItem.value = item;
  delayedPriceInputs.value.query = item.name;
  delayedPriceError.value = '';
}

function formatExchangeCandidate(item) {
  return [
    item.name,
    item.quality,
    item.type,
    item.size?.key,
    item.price ? `${item.price}` : null,
    `#${item.itemCid}`,
  ].filter(Boolean).join(' · ');
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '-';
}

async function startDelayedPriceQuery() {
  if (!canStartDelayedPriceQuery.value) return;

  emit('command-loading-change', 'StartDelayedPriceQuery');
  delayedPriceError.value = '';

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('StartDelayedPriceQuery', {
      itemCid: delayedPriceItemCid.value,
      delaySeconds: delayedPriceDelaySeconds.value,
      jitterSeconds: delayedPriceJitterSeconds.value,
    });
    if (response?.ok === false) throw new Error(response.error || t('inject.failed'));
    delayedPriceTask.value = response.value ?? response.result ?? response;
  } catch (error) {
    delayedPriceError.value = error?.message || t('inject.failed');
  } finally {
    emit('command-loading-change', '');
  }
}

async function refreshDelayedPriceQueryStatus() {
  if (!canRunAutoOperationCommand.value || props.commandLoading) return;

  emit('command-loading-change', 'GetDelayedPriceQueryStatus');
  delayedPriceError.value = '';

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('GetDelayedPriceQueryStatus', {});
    if (response?.ok === false) throw new Error(response.error || t('inject.failed'));
    delayedPriceTask.value = response.value ?? response.result ?? response;
  } catch (error) {
    delayedPriceError.value = error?.message || t('inject.failed');
  } finally {
    emit('command-loading-change', '');
  }
}

async function cancelDelayedPriceQuery() {
  if (!canCancelDelayedPriceQuery.value) return;

  emit('command-loading-change', 'CancelDelayedPriceQuery');
  delayedPriceError.value = '';

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('CancelDelayedPriceQuery', {
      taskId: delayedPriceTask.value.taskId,
    });
    if (response?.ok === false) throw new Error(response.error || t('inject.failed'));
    delayedPriceTask.value = response.value ?? response.result ?? response;
  } catch (error) {
    delayedPriceError.value = error?.message || t('inject.failed');
  } finally {
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <section class="listing-advice-panel delayed-price-panel" data-testid="delayed-price-query">
    <header class="section-head listing-advice-head">
      <div>
        <h2>{{ t('inject.delayedPriceQuery') }}</h2>
        <p>{{ t('inject.delayedPriceQuerySub') }}</p>
      </div>
      <button
        class="command-button"
        type="button"
        data-testid="delayed-price-status-refresh"
        :disabled="!canRunAutoOperationCommand || Boolean(props.commandLoading)"
        @click="refreshDelayedPriceQueryStatus"
      >
        {{ props.commandLoading === 'GetDelayedPriceQueryStatus' ? t('inject.autoOperationRunning') : t('inject.refreshStatus') }}
      </button>
    </header>

    <div class="auto-op-fields delayed-price-fields">
      <label>
        <span>{{ t('inject.delayedPriceItem') }}</span>
        <input
          v-model="delayedPriceInputs.query"
          type="text"
          :placeholder="t('inject.exchangeItemPlaceholder')"
          data-testid="delayed-price-query-input"
          @input="clearSelectedDelayedPriceItem"
        />
      </label>
      <label>
        <span>{{ t('inject.delaySeconds') }}</span>
        <input v-model="delayedPriceInputs.delaySeconds" type="number" min="1" data-testid="delayed-price-delay" />
      </label>
      <label>
        <span>{{ t('inject.jitterSeconds') }}</span>
        <input v-model="delayedPriceInputs.jitterSeconds" type="number" min="0" data-testid="delayed-price-jitter" />
      </label>
      <div class="metric">
        <span>{{ t('inject.executionWindow') }}</span>
        <strong data-testid="delayed-price-window">{{ delayedPriceWindow }}</strong>
      </div>
    </div>

    <div v-if="delayedPriceCandidates.length" class="command-grid" data-testid="delayed-price-candidates">
      <button
        v-for="item in delayedPriceCandidates"
        :key="item.itemCid"
        class="command-button"
        type="button"
        :data-testid="`delayed-price-candidate-${item.itemCid}`"
        @click="selectDelayedPriceItem(item)"
      >
        {{ formatExchangeCandidate(item) }}
      </button>
    </div>

    <p v-if="delayedPriceError" class="status-text is-error">
      {{ delayedPriceError }}
    </p>

    <div class="action-row">
      <button
        class="primary-button"
        type="button"
        data-testid="delayed-price-start"
        :disabled="!canStartDelayedPriceQuery"
        @click="startDelayedPriceQuery"
      >
        {{ props.commandLoading === 'StartDelayedPriceQuery' ? t('inject.autoOperationRunning') : t('inject.startDelayedPriceQuery') }}
      </button>
      <button
        class="command-button"
        type="button"
        data-testid="delayed-price-cancel"
        :disabled="!canCancelDelayedPriceQuery"
        @click="cancelDelayedPriceQuery"
      >
        {{ props.commandLoading === 'CancelDelayedPriceQuery' ? t('inject.autoOperationRunning') : t('inject.cancelDelayedPriceQuery') }}
      </button>
    </div>

    <div class="metric-grid">
      <div class="metric">
        <span>{{ t('inject.delayedTaskState') }}</span>
        <strong data-testid="delayed-price-status">{{ delayedPriceTask?.state || 'idle' }}</strong>
      </div>
      <div class="metric">
        <span>{{ t('inject.remainingSeconds') }}</span>
        <strong>{{ formatNumber(delayedPriceTask?.remainingSeconds) }}</strong>
      </div>
    </div>
  </section>
</template>
