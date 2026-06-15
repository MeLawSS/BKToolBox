<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectCollectionScanPanel' });

const { t } = useI18n();

const collectionScanState = ref(null);
const collectionScanError = ref('');
const collectionScanLoading = ref('');
const collectionScanInputs = ref({
  scanIntervalMinutes: '60',
  itemDelaySeconds: '5',
  itemJitterSeconds: '5',
});
let removeCollectionScanListener = null;

const canUseCollectionPriceScan = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.startCollectionPriceScan === 'function' &&
    typeof window.bidkingDesktop?.stopCollectionPriceScan === 'function' &&
    typeof window.bidkingDesktop?.getCollectionPriceScanStatus === 'function' &&
    typeof window.bidkingDesktop?.onCollectionPriceScanState === 'function',
  ),
);

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '-';
}

function applyCollectionScanState(state) {
  collectionScanState.value = state || { state: 'idle' };
  if (state?.config) {
    collectionScanInputs.value = {
      scanIntervalMinutes: String(state.config.scanIntervalMinutes ?? collectionScanInputs.value.scanIntervalMinutes),
      itemDelaySeconds: String(state.config.itemDelaySeconds ?? collectionScanInputs.value.itemDelaySeconds),
      itemJitterSeconds: String(state.config.itemJitterSeconds ?? collectionScanInputs.value.itemJitterSeconds),
    };
  }
}

function getCollectionScanConfig() {
  return {
    scanIntervalMinutes: Number(collectionScanInputs.value.scanIntervalMinutes),
    itemDelaySeconds: Number(collectionScanInputs.value.itemDelaySeconds),
    itemJitterSeconds: Number(collectionScanInputs.value.itemJitterSeconds),
  };
}

async function refreshCollectionScanStatus() {
  if (!canUseCollectionPriceScan.value) return;
  try {
    applyCollectionScanState(await window.bidkingDesktop.getCollectionPriceScanStatus());
  } catch (error) {
    collectionScanError.value = error?.message || String(error);
  }
}

async function startCollectionPriceScan() {
  if (!canUseCollectionPriceScan.value || collectionScanLoading.value) return;

  collectionScanLoading.value = 'start';
  collectionScanError.value = '';
  try {
    applyCollectionScanState(await window.bidkingDesktop.startCollectionPriceScan(getCollectionScanConfig()));
  } catch (error) {
    collectionScanError.value = error?.message || String(error);
  } finally {
    collectionScanLoading.value = '';
  }
}

async function stopCollectionPriceScan() {
  if (!canUseCollectionPriceScan.value || collectionScanLoading.value) return;

  collectionScanLoading.value = 'stop';
  collectionScanError.value = '';
  try {
    applyCollectionScanState(await window.bidkingDesktop.stopCollectionPriceScan());
  } catch (error) {
    collectionScanError.value = error?.message || String(error);
  } finally {
    collectionScanLoading.value = '';
  }
}

onMounted(() => {
  refreshCollectionScanStatus();
  if (canUseCollectionPriceScan.value) {
    removeCollectionScanListener = window.bidkingDesktop.onCollectionPriceScanState((state) => {
      applyCollectionScanState(state);
    });
  }
});

onUnmounted(() => {
  removeCollectionScanListener?.();
});
</script>

<template>
  <section class="listing-advice-panel collection-scan-panel" data-testid="collection-price-scan-panel">
    <header class="section-head listing-advice-head">
      <div>
        <h2>{{ t('inject.collectionScanTitle') }}</h2>
        <p>{{ t('inject.collectionScanDescription') }}</p>
      </div>
    </header>

    <template v-if="canUseCollectionPriceScan">
      <div class="auto-op-fields collection-scan-fields">
        <label>
          <span>{{ t('inject.collectionScanInterval') }}</span>
          <input
            v-model="collectionScanInputs.scanIntervalMinutes"
            data-testid="collection-scan-interval"
            type="number"
            min="1"
            max="1440"
          />
        </label>
        <label>
          <span>{{ t('inject.collectionScanItemDelay') }}</span>
          <input
            v-model="collectionScanInputs.itemDelaySeconds"
            data-testid="collection-scan-item-delay"
            type="number"
            min="0"
            max="3600"
          />
        </label>
        <label>
          <span>{{ t('inject.collectionScanItemJitter') }}</span>
          <input
            v-model="collectionScanInputs.itemJitterSeconds"
            data-testid="collection-scan-item-jitter"
            type="number"
            min="0"
            max="3600"
          />
        </label>
      </div>

      <div class="action-row">
        <button
          class="primary-button"
          data-testid="collection-scan-start"
          type="button"
          :disabled="Boolean(collectionScanLoading)"
          @click="startCollectionPriceScan"
        >
          {{ collectionScanLoading === 'start' ? t('inject.autoOperationRunning') : t('inject.collectionScanStart') }}
        </button>
        <button
          class="command-button"
          data-testid="collection-scan-stop"
          type="button"
          :disabled="Boolean(collectionScanLoading)"
          @click="stopCollectionPriceScan"
        >
          {{ collectionScanLoading === 'stop' ? t('inject.autoOperationRunning') : t('inject.collectionScanStop') }}
        </button>
      </div>

      <p v-if="collectionScanError" class="status-text is-error">
        {{ collectionScanError }}
      </p>

      <div class="collection-scan-status">
        <span>{{ t('inject.collectionScanState') }}</span>
        <strong>{{ collectionScanState?.state || 'idle' }}</strong>
        <span>{{ t('inject.collectionScanProgress') }}</span>
        <strong>{{ collectionScanState?.currentIndex ?? collectionScanState?.completedCount ?? 0 }} / {{ collectionScanState?.itemCount || 0 }}</strong>
        <span>{{ t('inject.collectionScanCurrentCid') }}</span>
        <strong>{{ collectionScanState?.currentCid || '-' }}</strong>
        <span>{{ t('inject.collectionScanWritten') }}</span>
        <strong>{{ collectionScanState?.writtenCount || 0 }}</strong>
        <span>{{ t('inject.collectionScanFailed') }}</span>
        <strong>{{ collectionScanState?.failedCount || 0 }}</strong>
        <span>{{ t('inject.collectionScanLatest') }}</span>
        <strong>{{ formatNumber(collectionScanState?.lastResult?.minPrice) }}</strong>
      </div>
    </template>

    <p v-else class="status-text is-muted">
      {{ t('inject.unavailable') }}
    </p>
  </section>
</template>
