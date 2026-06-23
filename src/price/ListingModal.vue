<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { computeDefaultUnitPrice, DEFAULT_LISTING_PRICE_PERCENT, computeTotal, validateListing } from './listing-form.js';

const props = defineProps({
  itemCid: { type: Number, required: true },
  name: { type: String, default: '' },
  quality: { type: String, default: '' },
  ownedCount: { type: Number, default: 0 },
  defaultPricePercent: { type: Number, default: DEFAULT_LISTING_PRICE_PERCENT },
});
const emit = defineEmits(['listed', 'close']);

const { t } = useI18n();

const tiers = ref([]);
const isLoading = ref(false);
const loadError = ref('');
const unitPriceInput = ref('');
const countInput = ref(props.ownedCount > 0 ? String(props.ownedCount) : '');
const isSubmitting = ref(false);
const submitError = ref('');

const validation = computed(() => validateListing({
  count: countInput.value,
  unitPrice: unitPriceInput.value,
  ownedCount: props.ownedCount,
}));
const total = computed(() => computeTotal({ count: countInput.value, unitPrice: unitPriceInput.value }));
const canSubmit = computed(() => validation.value.valid && !isSubmitting.value && !isLoading.value);

function getBridge() {
  const desktop = window.bidkingDesktop;
  if (!desktop?.isDesktop || typeof desktop.runAutoOperationCommand !== 'function') return null;
  return desktop;
}

async function loadTradeInfo() {
  const bridge = getBridge();
  if (!bridge) {
    loadError.value = t('price.listing.unavailable');
    return;
  }
  isLoading.value = true;
  loadError.value = '';
  try {
    const response = await bridge.runAutoOperationCommand('GetItemTradeInfo', { itemCid: props.itemCid });
    if (response?.ok === false) throw new Error(response.error || t('price.listing.loadError'));
    const value = response?.value || {};
    tiers.value = Array.isArray(value.tiers) ? value.tiers : [];
    const minPrice = Number(value.minPrice);
    const suggested = computeDefaultUnitPrice(minPrice, props.defaultPricePercent);
    unitPriceInput.value = suggested === null ? '' : String(suggested);
  } catch (error) {
    loadError.value = error?.message || String(error);
  } finally {
    isLoading.value = false;
  }
}

async function submit() {
  if (!validation.value.valid || isSubmitting.value) return;
  const bridge = getBridge();
  if (!bridge) {
    submitError.value = t('price.listing.unavailable');
    return;
  }
  const count = Number(countInput.value);
  const unitPrice = Number(unitPriceInput.value);
  isSubmitting.value = true;
  submitError.value = '';
  try {
    const response = await bridge.runAutoOperationCommand('ExchangeItem', { itemCid: props.itemCid, count, unitPrice });
    if (response?.ok === false) throw new Error(response.error || t('price.listing.submitError'));
    emit('listed', { itemCid: props.itemCid, count, unitPrice });
  } catch (error) {
    submitError.value = error?.message || String(error);
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(loadTradeInfo);
</script>

<template>
  <div class="listing-overlay" data-testid="listing-modal" @click.self="emit('close')">
    <div class="listing-dialog themed-dialog">
      <header class="listing-header">
        <h3>{{ t('price.listing.title') }}</h3>
        <p>{{ name }} · {{ itemCid }}<span v-if="quality"> / {{ quality }}</span></p>
      </header>

      <p v-if="loadError" class="error-text" data-testid="listing-load-error">{{ loadError }}</p>

      <section class="listing-tiers" data-testid="listing-tiers">
        <span class="listing-label">{{ t('price.listing.currentListings') }}</span>
        <p v-if="!tiers.length" class="empty-cell">{{ t('price.listing.noListings') }}</p>
        <ul v-else class="listing-tier-list">
          <li v-for="(tier, index) in tiers" :key="index">{{ tier.price }} × {{ tier.count }}</li>
        </ul>
      </section>

      <div class="listing-fields">
        <label>
          <span>{{ t('price.listing.unitPrice') }}</span>
          <input
            v-model="unitPriceInput"
            class="listing-input"
            type="number"
            min="1"
            data-testid="listing-unit-price"
          >
        </label>
        <label>
          <span>{{ t('price.listing.count') }}</span>
          <input
            v-model="countInput"
            class="listing-input"
            type="number"
            min="1"
            :max="ownedCount"
            data-testid="listing-count"
          >
          <small class="listing-note">{{ t('price.listing.owned') }}: {{ ownedCount }}</small>
        </label>
      </div>

      <p class="listing-total" data-testid="listing-total">
        {{ t('price.listing.total') }}: {{ total === null ? '-' : total.toLocaleString('en-US') }}
      </p>

      <p v-if="submitError" class="error-text" data-testid="listing-submit-error">{{ submitError }}</p>

      <footer class="listing-footer">
        <button type="button" class="ghost-button" data-testid="listing-cancel" @click="emit('close')">
          {{ t('price.listing.cancel') }}
        </button>
        <button
          type="button"
          class="primary-button"
          data-testid="listing-confirm"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ isSubmitting ? t('price.listing.submitting') : t('price.listing.confirm') }}
        </button>
      </footer>
    </div>
  </div>
</template>
