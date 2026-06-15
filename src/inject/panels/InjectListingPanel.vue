<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectListingPanel' });

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

const selectedExchangeItem = ref(null);
const exchangeItemInputs = ref({
  query: '',
  count: '1',
  unitPrice: '',
});
const listingAdvice = ref(null);
const listingAdviceContext = ref(null);
const listingAdviceLoading = ref(false);
const listingAdviceError = ref('');

const exchangeItemCandidates = computed(() => {
  const query = exchangeItemInputs.value.query.trim().toLowerCase();
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

const exchangeItemCid = computed(() => {
  const query = exchangeItemInputs.value.query.trim();
  if (/^\d+$/.test(query)) return Number(query);
  return selectedExchangeItem.value?.itemCid ? Number(selectedExchangeItem.value.itemCid) : 0;
});

const exchangeItemCount = computed(() => Number(exchangeItemInputs.value.count));
const exchangeItemUnitPrice = computed(() => Number(exchangeItemInputs.value.unitPrice));

const canSubmitExchangeItem = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.runAutoOperationCommand === 'function' &&
    !props.commandLoading &&
    exchangeItemCid.value > 0 &&
    exchangeItemCount.value > 0 &&
    exchangeItemUnitPrice.value > 0,
  ),
);

const canConfirmHighPriceListing = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.confirmHighPriceExchangeListing === 'function' &&
    !props.commandLoading &&
    exchangeItemCid.value > 0 &&
    exchangeItemCount.value > 0 &&
    listingAdviceContext.value?.itemCid === exchangeItemCid.value &&
    listingAdviceContext.value?.count === exchangeItemCount.value &&
    listingAdvice.value?.state === 'list_now' &&
    Number(listingAdvice.value?.suggestedUnitPrice) === exchangeItemUnitPrice.value,
  ),
);

function clearListingAdvice() {
  listingAdvice.value = null;
  listingAdviceContext.value = null;
  listingAdviceError.value = '';
}

function clearSelectedExchangeItem() {
  selectedExchangeItem.value = null;
  clearListingAdvice();
}

function selectExchangeItem(item) {
  selectedExchangeItem.value = item;
  exchangeItemInputs.value.query = item.name;
  clearListingAdvice();
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

async function submitExchangeItem() {
  if (!canSubmitExchangeItem.value) return;

  emit('command-loading-change', 'ExchangeItem');
  listingAdviceError.value = '';

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('ExchangeItem', {
      itemCid: exchangeItemCid.value,
      count: exchangeItemCount.value,
      unitPrice: exchangeItemUnitPrice.value,
    });
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
  } catch (error) {
    listingAdviceError.value = error?.message || t('inject.failed');
  } finally {
    emit('command-loading-change', '');
  }
}

async function refreshListingAdvice() {
  if (exchangeItemCid.value <= 0 || listingAdviceLoading.value) return;

  const itemCid = exchangeItemCid.value;
  const count = exchangeItemCount.value || 1;
  listingAdviceLoading.value = true;
  listingAdviceError.value = '';
  listingAdviceContext.value = null;

  try {
    const response = await fetch(`/api/exchange-listing-advice/${itemCid}?count=${count}&hours=24`);
    if (!response.ok) {
      throw new Error(t('inject.failed'));
    }
    const payload = await response.json();
    listingAdvice.value = payload;
    listingAdviceContext.value = { itemCid, count };
    if (payload?.suggestedUnitPrice !== undefined && payload?.suggestedUnitPrice !== null && payload?.suggestedUnitPrice !== '') {
      exchangeItemInputs.value.unitPrice = String(payload.suggestedUnitPrice);
    }
  } catch (error) {
    listingAdvice.value = null;
    listingAdviceError.value = error?.message || t('inject.failed');
  } finally {
    listingAdviceLoading.value = false;
  }
}

async function confirmHighPriceListing() {
  if (!canConfirmHighPriceListing.value) return;

  emit('command-loading-change', 'ConfirmHighPriceListing');

  try {
    const response = await window.bidkingDesktop.confirmHighPriceExchangeListing({
      itemCid: exchangeItemCid.value,
      count: exchangeItemCount.value,
      expectedUnitPrice: exchangeItemUnitPrice.value,
      hours: 24,
    });
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
  } catch (error) {
    listingAdviceError.value = error?.message || t('inject.failed');
  } finally {
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <div class="auto-op-fields">
    <label>
      <span>{{ t('inject.exchangeItem') }}</span>
      <input
        v-model="exchangeItemInputs.query"
        type="text"
        :placeholder="t('inject.exchangeItemPlaceholder')"
        data-testid="exchange-item-query"
        @input="clearSelectedExchangeItem"
      />
    </label>
    <label>
      <span>{{ t('inject.exchangeItemCount') }}</span>
      <input v-model="exchangeItemInputs.count" type="number" min="1" data-testid="exchange-item-count" />
    </label>
    <label>
      <span>{{ t('inject.exchangeItemUnitPrice') }}</span>
      <input v-model="exchangeItemInputs.unitPrice" type="number" min="1" data-testid="exchange-item-unit-price" />
    </label>
    <button
      class="primary-button"
      type="button"
      data-testid="exchange-item-button"
      :disabled="!canSubmitExchangeItem"
      @click="submitExchangeItem"
    >
      {{ props.commandLoading === 'ExchangeItem' ? t('inject.autoOperationRunning') : t('inject.exchangeItemSubmit') }}
    </button>
  </div>

  <div v-if="exchangeItemCandidates.length" class="command-grid" data-testid="exchange-item-candidates">
    <button
      v-for="item in exchangeItemCandidates"
      :key="item.itemCid"
      class="command-button"
      type="button"
      :data-testid="`exchange-item-candidate-${item.itemCid}`"
      @click="selectExchangeItem(item)"
    >
      {{ formatExchangeCandidate(item) }}
    </button>
  </div>

  <section class="listing-advice-panel" data-testid="exchange-listing-advice">
    <header class="section-head listing-advice-head">
      <div>
        <h2>{{ t('inject.listingAdvisor') }}</h2>
        <p>{{ t('inject.listingAdvisorSub') }}</p>
      </div>
      <button
        class="command-button"
        type="button"
        data-testid="refresh-listing-advice"
        :disabled="exchangeItemCid <= 0 || listingAdviceLoading"
        @click="refreshListingAdvice"
      >
        {{ listingAdviceLoading ? t('inject.autoOperationRunning') : t('inject.refreshAdvice') }}
      </button>
    </header>

    <p v-if="listingAdviceError" class="status-text is-error">
      {{ listingAdviceError }}
    </p>

    <div class="advisor-grid">
      <div>
        <span>{{ t('inject.adviceState') }}</span>
        <strong>{{ listingAdvice?.state || '-' }}</strong>
      </div>
      <div>
        <span>{{ t('inject.suggestedUnitPrice') }}</span>
        <strong>{{ formatNumber(listingAdvice?.suggestedUnitPrice) }}</strong>
      </div>
      <div>
        <span>{{ t('inject.netRevenuePerItem') }}</span>
        <strong>{{ formatNumber(listingAdvice?.netRevenuePerItem) }}</strong>
      </div>
      <div>
        <span>{{ t('inject.expirationRisk') }}</span>
        <strong>{{ listingAdvice?.expirationRisk || '-' }}</strong>
      </div>
      <div class="advisor-reason">
        <span>{{ t('inject.reason') }}</span>
        <strong>{{ listingAdvice?.reason || '-' }}</strong>
      </div>
    </div>

    <div class="action-row">
      <button
        class="primary-button"
        type="button"
        data-testid="confirm-high-price-listing"
        :disabled="!canConfirmHighPriceListing"
        @click="confirmHighPriceListing"
      >
        {{ props.commandLoading === 'ConfirmHighPriceListing' ? t('inject.autoOperationRunning') : t('inject.confirmHighPriceListing') }}
      </button>
    </div>
  </section>
</template>
