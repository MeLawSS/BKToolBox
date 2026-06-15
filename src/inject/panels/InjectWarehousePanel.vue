<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectWarehousePanel' });

const props = defineProps({
  collectibles: {
    type: Array,
    default: () => [],
  },
});

const { t } = useI18n();

const warehouseItems = ref([]);
const warehouseLoading = ref(false);
const warehouseError = ref('');

const canRunAutoOperationCommand = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ),
);

const collectiblesByCid = computed(() => {
  const map = {};
  for (const item of props.collectibles || []) {
    if (Number.isFinite(Number(item.itemCid))) map[Number(item.itemCid)] = item;
  }
  return map;
});

const warehouseDisplayItems = computed(() => warehouseItems.value
  .map((row) => {
    const itemCid = Number(row?.itemCid ?? row?.cid);
    const count = Number(row?.count ?? row?.itemCount);
    const collectible = collectiblesByCid.value[itemCid] || null;
    if (!Number.isSafeInteger(itemCid) || itemCid <= 0) return null;
    if (!collectible) return null;
    return {
      itemCid,
      count: Number.isFinite(count) ? count : 0,
      collectible,
    };
  })
  .filter(Boolean));

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '-';
}

async function fetchWarehouseItems() {
  if (!canRunAutoOperationCommand.value || warehouseLoading.value) return;

  warehouseLoading.value = true;
  warehouseError.value = '';

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('GetStockCollectibleCounts', {});
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    warehouseItems.value = Array.isArray(response?.value?.items) ? response.value.items : [];
  } catch (error) {
    warehouseError.value = error?.message || t('inject.failed');
  } finally {
    warehouseLoading.value = false;
  }
}
</script>

<template>
  <section class="listing-advice-panel warehouse-panel" data-testid="warehouse-items-panel">
    <header class="section-head listing-advice-head">
      <div>
        <h2>{{ t('inject.warehouseItems') }}</h2>
        <p>{{ t('inject.warehouseItemsSub') }}</p>
      </div>
      <button
        class="command-button"
        type="button"
        data-testid="warehouse-items-button"
        :disabled="!canRunAutoOperationCommand || warehouseLoading"
        @click="fetchWarehouseItems"
      >
        {{ warehouseLoading ? t('inject.autoOperationRunning') : t('inject.fetchWarehouseItems') }}
      </button>
    </header>

    <p v-if="warehouseError" class="status-text is-error">
      {{ warehouseError }}
    </p>

    <div class="warehouse-table-wrap">
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>{{ t('inject.warehouseItemName') }}</th>
            <th>{{ t('inject.warehouseItemQuality') }}</th>
            <th>{{ t('inject.warehouseItemType') }}</th>
            <th>{{ t('inject.warehouseItemCid') }}</th>
            <th>{{ t('inject.warehouseItemCount') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!warehouseDisplayItems.length">
            <td colspan="5" class="empty-cell">{{ t('inject.warehouseItemsEmpty') }}</td>
          </tr>
          <tr
            v-for="item in warehouseDisplayItems"
            :key="item.itemCid"
            :data-testid="`warehouse-item-${item.itemCid}`"
          >
            <td>{{ item.collectible.name }}</td>
            <td>{{ item.collectible.quality || '-' }}</td>
            <td>{{ item.collectible.type || '-' }}</td>
            <td>{{ item.itemCid }}</td>
            <td>{{ formatNumber(item.count) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
