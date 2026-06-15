<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectCabinetRewardPanel' });

const { t } = useI18n();

const loadingAction = ref('');
const result = ref(null);
const errorMessage = ref('');

const canUseCabinetReward = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.queryCabinetReward === 'function' &&
    typeof window.bidkingDesktop?.claimCabinetReward === 'function',
  ),
);

const loading = computed(() => Boolean(loadingAction.value));

const formattedAward = computed(() => {
  const value = Number(result.value?.value?.awardCount);
  return Number.isFinite(value) ? value.toLocaleString() : '-';
});

async function fetchCabinetReward() {
  if (!canUseCabinetReward.value || loading.value) return;

  loadingAction.value = 'query';
  errorMessage.value = '';

  try {
    const response = await window.bidkingDesktop.queryCabinetReward();
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    result.value = response;
  } catch (error) {
    errorMessage.value = error?.message || t('inject.failed');
  } finally {
    loadingAction.value = '';
  }
}

async function claimCabinetReward() {
  if (!canUseCabinetReward.value || loading.value) return;

  loadingAction.value = 'claim';
  errorMessage.value = '';

  try {
    const response = await window.bidkingDesktop.claimCabinetReward();
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    result.value = response;
  } catch (error) {
    errorMessage.value = error?.message || t('inject.failed');
  } finally {
    loadingAction.value = '';
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
        data-testid="cabinet-reward-button"
        :disabled="!canUseCabinetReward || loading"
        @click="fetchCabinetReward"
      >
        {{ loadingAction === 'query' ? t('inject.fetchingCabinetReward') : t('inject.fetchCabinetReward') }}
      </button>
      <button
        class="primary-button"
        type="button"
        data-testid="cabinet-claim-button"
        :disabled="!canUseCabinetReward || loading"
        @click="claimCabinetReward"
      >
        {{ loadingAction === 'claim' ? t('inject.claimingCabinetReward') : t('inject.claimCabinetReward') }}
      </button>
    </div>
  </header>

  <p v-if="!canUseCabinetReward" class="status-text is-muted">
    {{ t('inject.unavailable') }}
  </p>
  <p v-else-if="errorMessage" class="status-text is-error">
    {{ errorMessage }}
  </p>

  <div class="metric-grid">
    <div class="metric">
      <span>{{ t('inject.latestValue') }}</span>
      <strong data-testid="cabinet-reward-value">
        {{ result ? formattedAward : t('inject.waiting') }}
      </strong>
    </div>
    <div class="metric">
      <span>{{ t('inject.observedAt') }}</span>
      <strong>{{ result?.value?.observedAt || '-' }}</strong>
    </div>
  </div>

  <div v-if="result?.path" class="output-path">
    <span>{{ t('inject.outputPath') }}</span>
    <code>{{ result.path }}</code>
  </div>
</template>
