<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import TopBar from '../shared/TopBar.vue';
import { useI18n } from '../shared/i18n.js';
import PriceTrendChart from './PriceTrendChart.vue';
import ListingModal from './ListingModal.vue';
import { DEFAULT_LISTING_PRICE_PERCENT, parseListingDefaultPricePercent, computeDefaultUnitPrice } from './listing-form.js';

const { t, isEnglish } = useI18n();
const LISTING_DEFAULT_PRICE_PERCENT_KEY = 'bidking-price-listing-default-percent:v1';

const collectibles = ref([]);
const latestPrices = ref([]);
const collectionCids = ref([]);
const warehouseRows = ref([]);
const activeTab = ref('opportunities');
const selectedItemCid = ref(null);
const warehouseSelectedIndex = ref(0);
const liveCollectionCids = ref(undefined);
const selectedItemTab = ref(null);
const selectedHistory = ref([]);
const searchText = ref('');
const errorText = ref('');
const isRefreshingCollections = ref(false);
const isRefreshingWarehouse = ref(false);
const isRefreshingItem = ref(false);
const itemRefreshError = ref('');
const warehouseError = ref('');
const opportunitySort = ref({ key: 'minPrice', direction: 'desc' });
const warehouseSort = ref({ key: null, direction: 'asc' });
const isListingModalOpen = ref(false);
const listingMessage = ref('');
const isQuickListing = ref(false);
const quickListingError = ref('');
const listingDefaultPricePercentInput = ref(String(DEFAULT_LISTING_PRICE_PERCENT));

const tabs = [
  { key: 'opportunities', labelKey: 'price.tabs.opportunities' },
  { key: 'collections', labelKey: 'price.tabs.collections' },
  { key: 'warehouse', labelKey: 'price.tabs.warehouse' },
];
const MAIN_WAREHOUSE_STOCK_ID = 0;

const collectiblesByCid = computed(() => {
  const map = {};
  for (const item of collectibles.value) {
    const cid = getCollectibleCid(item);
    if (cid) map[cid] = { ...item, itemCid: cid };
  }
  return map;
});

const latestByCid = computed(() => {
  const map = {};
  for (const item of latestPrices.value) {
    const cid = Number(item.itemCid);
    if (Number.isSafeInteger(cid)) map[cid] = item;
  }
  return map;
});

const opportunities = computed(() => latestPrices.value
  .map((latest) => buildDisplayItem(latest.itemCid))
  .filter((item) => item && item.basePrice > 0 && item.minPrice >= item.basePrice * 2)
  .sort(compareOpportunityItems));

const collectionItems = computed(() => collectionCids.value
  .map((itemCid) => buildDisplayItem(itemCid))
  .filter(Boolean));

const warehouseItems = computed(() => {
  const items = warehouseRows.value
    .map((row) => {
      const item = buildDisplayItem(row?.itemCid ?? row?.cid);
      const count = Number(row?.count ?? row?.itemCount);
      if (!item) return null;
      return {
        ...item,
        count: Number.isFinite(count) ? count : 0,
        occupiedCells: getOccupiedCells(item),
      };
    })
    .filter(Boolean);

  // Apply live collection filter when available
  const cidSet = liveCollectionCids.value;
  const filtered = cidSet instanceof Set
    ? items.filter(item => cidSet.has(item.itemCid))
    : items;

  if (!warehouseSort.value.key) return filtered;

  return [...filtered].sort(compareWarehouseItems);
});

function getOccupiedCells(item) {
  const width = Number(item?.size?.width);
  const height = Number(item?.size?.height);
  if (Number.isFinite(width) && Number.isFinite(height)) return width * height;
  const sizeKeyMatch = String(item?.size?.key || '').match(/^(\d+)x(\d+)$/i);
  if (!sizeKeyMatch) return null;
  return Number(sizeKeyMatch[1]) * Number(sizeKeyMatch[2]);
}

function compareWarehouseItems(left, right) {
  const direction = warehouseSort.value.direction === 'asc' ? 1 : -1;
  const key = warehouseSort.value.key;
  const leftValue = Number(left?.[key]);
  const rightValue = Number(right?.[key]);
  const leftFinite = Number.isFinite(leftValue);
  const rightFinite = Number.isFinite(rightValue);
  if (leftFinite && rightFinite && leftValue !== rightValue) return (leftValue - rightValue) * direction;
  if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
  return Number(left.itemCid) - Number(right.itemCid);
}

function setWarehouseSort(key) {
  if (warehouseSort.value.key === key) {
    warehouseSort.value = {
      key,
      direction: warehouseSort.value.direction === 'asc' ? 'desc' : 'asc',
    };
    return;
  }
  warehouseSort.value = { key, direction: 'asc' };
}

function getWarehouseAriaSort(key) {
  if (warehouseSort.value.key !== key) return 'none';
  return warehouseSort.value.direction === 'asc' ? 'ascending' : 'descending';
}

function getWarehouseSortIndicator(key) {
  if (warehouseSort.value.key !== key) return '↕';
  return warehouseSort.value.direction === 'asc' ? '↑' : '↓';
}

const searchResults = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  if (!query) return Object.values(collectiblesByCid.value).slice(0, 50).map((item) => buildDisplayItem(item.itemCid)).filter(Boolean);
  return Object.values(collectiblesByCid.value)
    .filter((item) => [
      item.name,
      item.itemCid,
      item.quality,
      item.type,
    ].some((value) => String(value ?? '').toLowerCase().includes(query)))
    .map((item) => buildDisplayItem(item.itemCid))
    .filter(Boolean)
    .slice(0, 50);
});

const selectedDisplayItem = computed(() => buildDisplayItem(selectedItemCid.value));

const canRefreshSelectedItem = computed(() =>
  Boolean(
    selectedItemCid.value
    && window.bidkingDesktop?.isDesktop
    && typeof window.bidkingDesktop?.refreshItemTradeInfo === 'function',
  ));

const canRefreshWarehouse = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop
    && typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ));

const listingDefaultPricePercent = computed(() =>
  parseListingDefaultPricePercent(listingDefaultPricePercentInput.value));

const selectedOwnedCount = computed(() => {
  const row = warehouseItems.value.find((item) => item.itemCid === selectedItemCid.value);
  return row ? Number(row.count) || 0 : 0;
});

const canListItem = computed(() =>
  Boolean(
    selectedItemCid.value
    && selectedOwnedCount.value > 0
    && window.bidkingDesktop?.isDesktop
    && typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ));

const historyStats = computed(() => {
  const prices = selectedHistory.value.map((row) => Number(row.minPrice)).filter(Number.isFinite);
  if (!prices.length) return null;
  return {
    latest: prices.at(-1),
    low: Math.min(...prices),
    high: Math.max(...prices),
    count: prices.length,
  };
});

function getCollectibleCid(collectible) {
  const explicitCid = collectible?.itemCid ?? collectible?.cid ?? collectible?.id;
  if (explicitCid !== undefined && explicitCid !== null && explicitCid !== '') return Number(explicitCid);
  const match = String(collectible?.image || '').match(/icon_(\d+)\.png/);
  return match ? Number(match[1]) : null;
}

function toNonNegativeInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function toPositiveCount(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function buildWarehouseRowsFromStockContainers(payload) {
  const containers = Array.isArray(payload?.containers)
    ? payload.containers
    : Array.isArray(payload)
      ? payload
      : [];
  const totalCountsByCid = new Map();
  const mainWarehouseItemCids = [];
  const seenMainWarehouseItemCids = new Set();

  for (const container of containers) {
    const stockId = toNonNegativeInteger(container?.stockId);
    if (stockId === null) continue;
    const items = Array.isArray(container?.items) ? container.items : [];

    for (const item of items) {
      const itemCid = toNonNegativeInteger(item?.itemCid ?? item?.itemId ?? item?.cid);
      if (!itemCid) continue;
      totalCountsByCid.set(itemCid, (totalCountsByCid.get(itemCid) || 0) + toPositiveCount(item?.count, 1));
      if (stockId !== MAIN_WAREHOUSE_STOCK_ID || seenMainWarehouseItemCids.has(itemCid)) continue;
      seenMainWarehouseItemCids.add(itemCid);
      mainWarehouseItemCids.push(itemCid);
    }
  }

  return mainWarehouseItemCids.map((itemCid) => ({
    itemCid,
    count: totalCountsByCid.get(itemCid) || 0,
  }));
}

function buildDisplayItem(itemCid) {
  const cid = Number(itemCid);
  if (!Number.isSafeInteger(cid)) return null;
  const collectible = collectiblesByCid.value[cid];
  const latest = latestByCid.value[cid];
  if (!collectible) return null;
  const basePrice = Number(collectible.price);
  const minPrice = Number(latest?.minPrice);
  return {
    ...collectible,
    itemCid: cid,
    basePrice: Number.isFinite(basePrice) ? basePrice : 0,
    minPrice: Number.isFinite(minPrice) ? minPrice : null,
    ratio: Number.isFinite(basePrice) && basePrice > 0 && Number.isFinite(minPrice) ? minPrice / basePrice : null,
    observedAt: latest?.observedAt || null,
  };
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '-';
}

function formatRatio(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}x` : '-';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(isEnglish.value ? 'en-US' : 'zh-CN');
}

function compareOpportunityItems(left, right) {
  const direction = opportunitySort.value.direction === 'asc' ? 1 : -1;
  const key = opportunitySort.value.key;
  const leftValue = Number(left?.[key]);
  const rightValue = Number(right?.[key]);
  const leftFinite = Number.isFinite(leftValue);
  const rightFinite = Number.isFinite(rightValue);
  if (leftFinite && rightFinite && leftValue !== rightValue) return (leftValue - rightValue) * direction;
  if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
  return Number(left.itemCid) - Number(right.itemCid);
}

function setOpportunitySort(key) {
  if (opportunitySort.value.key === key) {
    opportunitySort.value = {
      key,
      direction: opportunitySort.value.direction === 'asc' ? 'desc' : 'asc',
    };
    return;
  }
  opportunitySort.value = { key, direction: 'asc' };
}

function getOpportunityAriaSort(key) {
  if (opportunitySort.value.key !== key) return 'none';
  return opportunitySort.value.direction === 'asc' ? 'ascending' : 'descending';
}

function getOpportunitySortIndicator(key) {
  if (opportunitySort.value.key !== key) return '↕';
  return opportunitySort.value.direction === 'asc' ? '↑' : '↓';
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

function restoreListingDefaultPricePercent() {
  try {
    const stored = window.localStorage.getItem(LISTING_DEFAULT_PRICE_PERCENT_KEY);
    if (!stored) return;
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed > 0) listingDefaultPricePercentInput.value = stored;
  } catch {
    // Listing default price persistence is optional.
  }
}

function normalizeListingDefaultPricePercent() {
  listingDefaultPricePercentInput.value = String(
    parseListingDefaultPricePercent(listingDefaultPricePercentInput.value),
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function fetchInitialData() {
  try {
    const [collectiblesPayload, latestPayload] = await Promise.all([
      fetchJson('/data/collectibles.json'),
      fetchJson('/api/price-history/latest'),
    ]);
    collectibles.value = Array.isArray(collectiblesPayload) ? collectiblesPayload : [];
    latestPrices.value = Array.isArray(latestPayload.items) ? latestPayload.items : [];
  } catch (error) {
    errorText.value = getErrorMessage(error);
    return;
  }

  try {
    const collectionsPayload = await fetchJson('/api/price-history/collections');
    collectionCids.value = Array.isArray(collectionsPayload.itemCids) ? collectionsPayload.itemCids : [];
  } catch {
    // Collections endpoint is optional — opportunities and search still work without it.
  }
}

async function refreshCollections() {
  if (isRefreshingCollections.value) return;
  isRefreshingCollections.value = true;
  try {
    const [latestPayload, collectionsPayload] = await Promise.all([
      fetchJson('/api/price-history/latest'),
      fetchJson('/api/price-history/collections'),
    ]);
    latestPrices.value = Array.isArray(latestPayload.items) ? latestPayload.items : [];
    collectionCids.value = Array.isArray(collectionsPayload.itemCids) ? collectionsPayload.itemCids : [];
    if (selectedItemCid.value) await selectItem(selectedItemCid.value);
  } catch (error) {
    errorText.value = getErrorMessage(error);
  } finally {
    isRefreshingCollections.value = false;
  }
}

async function refreshWarehouseItems() {
  if (isRefreshingWarehouse.value) return;
  if (!canRefreshWarehouse.value) {
    warehouseError.value = t('price.refreshWarehouseUnavailable');
    return;
  }

  isRefreshingWarehouse.value = true;
  warehouseError.value = '';

  // Cache only a successful live-collection fetch.
  // If the bridge fails transiently, leave the state retryable for the next refresh.
  if (liveCollectionCids.value === undefined) {
    try {
      const cidResponse = await window.bidkingDesktop.runAutoOperationCommand('GetCollectionItemCids', {});
      if (cidResponse?.ok !== false && Array.isArray(cidResponse?.value?.cids)) {
        liveCollectionCids.value = new Set(
          cidResponse.value.cids.map(Number).filter(Number.isSafeInteger)
        );
      }
    } catch (error) {
      console.error('GetCollectionItemCids failed:', error);
    }
  }

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('GetStockContainers', {});
    if (response?.ok === false) throw new Error(response.error || t('price.refreshWarehouseUnavailable'));
    const nextRows = buildWarehouseRowsFromStockContainers(response?.value ?? response);
    warehouseRows.value = nextRows;
    await syncWarehouseSelection();
  } catch (error) {
    warehouseError.value = getErrorMessage(error);
  } finally {
    isRefreshingWarehouse.value = false;
  }
}

async function loadSelectedHistory(cid) {
  const payload = await fetchJson(`/api/price-history/item/${cid}?limit=1000`);
  const history = Array.isArray(payload.history) ? payload.history : [];
  if (selectedItemCid.value === cid) selectedHistory.value = history;
  return history;
}

function clearSelectedItemState() {
  selectedItemCid.value = null;
  selectedItemTab.value = null;
  selectedHistory.value = [];
  itemRefreshError.value = '';
  listingMessage.value = '';
  quickListingError.value = '';
  isListingModalOpen.value = false;
}

function getVisibleWarehouseCids() {
  return warehouseItems.value
    .map((item) => Number(item?.itemCid))
    .filter(Number.isSafeInteger);
}

function getRawWarehouseCids() {
  return warehouseRows.value
    .map((row) => Number(row?.itemCid ?? row?.cid))
    .filter(Number.isSafeInteger);
}

function getWarehouseCandidateCids() {
  const visibleCids = getVisibleWarehouseCids();
  if (visibleCids.length) return visibleCids;
  // When collection filter is active, do NOT fall back to raw warehouse rows
  // — that would leak filtered-out CIDs into the selection.
  if (liveCollectionCids.value instanceof Set) return [];
  return getRawWarehouseCids();
}

function resolveWarehouseSelectedCid() {
  const warehouseCids = getWarehouseCandidateCids();
  if (!warehouseCids.length) return null;

  const idx = warehouseSelectedIndex.value;
  if (idx < warehouseCids.length) return warehouseCids[idx];
  return warehouseCids[warehouseCids.length - 1];
}

function resolveRequestedWarehouseCid(requestedCid) {
  const warehouseCids = getWarehouseCandidateCids();
  if (!warehouseCids.length) return requestedCid;
  if (warehouseCids.includes(requestedCid)) return requestedCid;

  // Fallback: requested CID not in warehouse list → use index
  const idx = warehouseSelectedIndex.value;
  if (idx < warehouseCids.length) return warehouseCids[idx];
  return warehouseCids[warehouseCids.length - 1];
}

async function selectItem(itemCid, itemTab = activeTab.value) {
  const cid = Number(itemCid);
  if (!Number.isSafeInteger(cid)) return;
  const nextCid = itemTab === 'warehouse'
    ? resolveRequestedWarehouseCid(cid)
    : cid;

  if (itemTab === 'warehouse') {
    const idx = warehouseItems.value.findIndex(item => item.itemCid === nextCid);
    if (idx >= 0) warehouseSelectedIndex.value = idx;
  }

  selectedItemCid.value = nextCid;
  selectedItemTab.value = itemTab;
  selectedHistory.value = [];
  itemRefreshError.value = '';
  listingMessage.value = '';
  quickListingError.value = '';
  isListingModalOpen.value = false;
  try {
    await loadSelectedHistory(nextCid);
  } catch (error) {
    errorText.value = getErrorMessage(error);
  }
}

async function syncWarehouseSelection() {
  if (activeTab.value !== 'warehouse') return;
  const nextCid = resolveWarehouseSelectedCid();
  if (!nextCid) {
    clearSelectedItemState();
    return;
  }
  if (selectedItemCid.value === nextCid && selectedItemTab.value === 'warehouse') return;
  await selectItem(nextCid, 'warehouse');
}

async function refreshSelectedItem() {
  if (!selectedItemCid.value || isRefreshingItem.value) return;
  if (!canRefreshSelectedItem.value) {
    itemRefreshError.value = t('price.refreshItemUnavailable');
    return;
  }
  const cid = selectedItemCid.value;
  isRefreshingItem.value = true;
  itemRefreshError.value = '';
  try {
    const result = await window.bidkingDesktop.refreshItemTradeInfo(cid);
    if (result?.ok === false) throw new Error(result.error || t('price.refreshItemUnavailable'));
    const latestPayload = await fetchJson('/api/price-history/latest');
    latestPrices.value = Array.isArray(latestPayload.items) ? latestPayload.items : [];
    if (selectedItemCid.value === cid) await loadSelectedHistory(cid);
  } catch (error) {
    if (selectedItemCid.value === cid) itemRefreshError.value = getErrorMessage(error);
  } finally {
    isRefreshingItem.value = false;
  }
}

function openListingModal() {
  listingMessage.value = '';
  quickListingError.value = '';
  isListingModalOpen.value = true;
}

function closeListingModal() {
  isListingModalOpen.value = false;
}

async function quickListSelectedItem() {
  if (!selectedItemCid.value || isQuickListing.value) return;
  if (!selectedOwnedCount.value) return;

  isQuickListing.value = true;
  listingMessage.value = '';
  quickListingError.value = '';

  const itemCid = selectedItemCid.value;
  const count = selectedOwnedCount.value;
  const basePrice = Number(selectedDisplayItem.value?.basePrice);

  try {
    const tradeInfo = await window.bidkingDesktop.runAutoOperationCommand('GetItemTradeInfo', { itemCid });
    if (tradeInfo?.ok === false) throw new Error(tradeInfo.error || t('price.quickListing.fetchError'));

    const minPrice = Number(tradeInfo?.value?.minPrice);
    if (!Number.isFinite(minPrice) || minPrice <= 0) {
      throw new Error(t('price.quickListing.fetchError'));
    }

    const listPrice = computeDefaultUnitPrice(minPrice, listingDefaultPricePercent.value);
    if (listPrice === null) {
      throw new Error(t('price.quickListing.fetchError'));
    }

    if (Number.isFinite(basePrice) && basePrice > 0 && listPrice < basePrice) {
      if (selectedItemCid.value === itemCid && activeTab.value === 'warehouse') {
        quickListingError.value = t('price.quickListing.belowBasePrice');
      }
      return;
    }

    const response = await window.bidkingDesktop.runAutoOperationCommand('ExchangeItem', {
      itemCid,
      count,
      unitPrice: listPrice,
    });
    if (response?.ok === false) throw new Error(response.error || t('price.listing.submitError'));

    await refreshWarehouseItems();
    if (selectedItemCid.value === itemCid && activeTab.value === 'warehouse') {
      listingMessage.value = t('price.listing.success');
    }
  } catch (error) {
    if (selectedItemCid.value === itemCid && activeTab.value === 'warehouse') {
      quickListingError.value = error?.message || String(error);
    }
  } finally {
    isQuickListing.value = false;
  }
}

async function onItemListed() {
  isListingModalOpen.value = false;
  quickListingError.value = '';
  listingMessage.value = t('price.listing.success');
  await refreshWarehouseItems();
}

watch(activeTab, (tab) => {
  if (tab !== 'warehouse') return;
  const warehouseCids = getVisibleWarehouseCids();
  if (
    warehouseCids.length &&
    selectedItemTab.value === 'warehouse' &&
    warehouseCids.includes(selectedItemCid.value)
  ) {
    return;
  }
  syncWarehouseSelection();
});
watch(
  () => {
    if (activeTab.value !== 'warehouse' || !selectedItemCid.value) return -1;
    return warehouseItems.value.findIndex(item => item.itemCid === selectedItemCid.value);
  },
  (newIdx) => {
    if (newIdx >= 0) warehouseSelectedIndex.value = newIdx;
  },
);
watch(() => getVisibleWarehouseCids().join(','), (visibleCidsKey) => {
  if (activeTab.value !== 'warehouse' || !visibleCidsKey) return;
  const visibleCids = getVisibleWarehouseCids();
  if (selectedItemTab.value === 'warehouse' && visibleCids.includes(selectedItemCid.value)) return;
  syncWarehouseSelection();
});
watch(listingDefaultPricePercentInput, (value) => {
  try {
    const trimmed = String(value ?? '').trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed) || parsed <= 0) {
      window.localStorage.removeItem(LISTING_DEFAULT_PRICE_PERCENT_KEY);
      return;
    }
    window.localStorage.setItem(LISTING_DEFAULT_PRICE_PERCENT_KEY, trimmed);
  } catch {
    // Listing default price persistence is optional.
  }
});

onMounted(() => {
  restoreListingDefaultPricePercent();
  fetchInitialData();
});
</script>

<template>
  <TopBar active-page="price" />

  <main class="price-page">
    <section class="page-heading">
      <h1>{{ t('price.title') }}</h1>
      <p>{{ t('price.subtitle') }}</p>
    </section>

    <p v-if="errorText" class="error-text">{{ errorText }}</p>

    <div class="price-tabs" role="tablist" :aria-label="t('price.tabs.label')">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key ? 'true' : 'false'"
        :class="{ active: activeTab === tab.key }"
        :data-testid="`price-tab-${tab.key}`"
        @click="activeTab = tab.key"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>

    <section class="price-layout">
      <section v-if="activeTab === 'opportunities'" class="opportunity-panel" data-testid="price-opportunities">
        <header>
          <div>
            <h2>{{ t('price.opportunities') }}</h2>
            <p>{{ t('price.opportunitiesSub') }}</p>
          </div>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('price.item') }}</th>
                <th>{{ t('price.quality') }}</th>
                <th :aria-sort="getOpportunityAriaSort('basePrice')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-basePrice"
                    @click="setOpportunitySort('basePrice')"
                  >
                    <span>{{ t('price.basePrice') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getOpportunitySortIndicator('basePrice') }}</span>
                  </button>
                </th>
                <th :aria-sort="getOpportunityAriaSort('minPrice')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-minPrice"
                    @click="setOpportunitySort('minPrice')"
                  >
                    <span>{{ t('price.minPrice') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getOpportunitySortIndicator('minPrice') }}</span>
                  </button>
                </th>
                <th :aria-sort="getOpportunityAriaSort('ratio')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-ratio"
                    @click="setOpportunitySort('ratio')"
                  >
                    <span>{{ t('price.ratio') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getOpportunitySortIndicator('ratio') }}</span>
                  </button>
                </th>
                <th>{{ t('price.updatedAt') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!opportunities.length">
                <td colspan="6" class="empty-cell">{{ t('price.noOpportunities') }}</td>
              </tr>
              <tr
                v-for="item in opportunities"
                :key="item.itemCid"
                :data-testid="`opportunity-${item.itemCid}`"
                :class="{ selected: selectedItemCid === item.itemCid }"
                @click="selectItem(item.itemCid)"
              >
                <td>{{ item.name }}</td>
                <td>{{ item.quality }}</td>
                <td>{{ formatNumber(item.basePrice) }}</td>
                <td>{{ formatNumber(item.minPrice) }}</td>
                <td>{{ formatRatio(item.ratio) }}</td>
                <td>{{ formatDateTime(item.observedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeTab === 'collections'" class="opportunity-panel" data-testid="price-collections">
        <header>
          <div>
            <h2>{{ t('price.collections') }}</h2>
            <p>{{ t('price.collectionsSub') }}</p>
          </div>
          <button
            class="ghost-button"
            type="button"
            data-testid="price-collections-refresh"
            :disabled="isRefreshingCollections"
            @click="refreshCollections"
          >
            {{ isRefreshingCollections ? t('price.refreshingCollections') : t('price.refreshCollections') }}
          </button>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('price.item') }}</th>
                <th>{{ t('price.quality') }}</th>
                <th>{{ t('price.basePrice') }}</th>
                <th>{{ t('price.latestPrice') }}</th>
                <th>{{ t('price.updatedAt') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!collectionItems.length">
                <td colspan="5" class="empty-cell">{{ t('price.noCollections') }}</td>
              </tr>
              <tr
                v-for="item in collectionItems"
                :key="item.itemCid"
                :data-testid="`collection-${item.itemCid}`"
                :class="{ selected: selectedItemCid === item.itemCid }"
                @click="selectItem(item.itemCid)"
              >
                <td>{{ item.name }}</td>
                <td>{{ item.quality }}</td>
                <td>{{ formatNumber(item.basePrice) }}</td>
                <td>{{ formatNumber(item.minPrice) }}</td>
                <td>{{ formatDateTime(item.observedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else class="opportunity-panel" data-testid="price-warehouse">
        <header>
          <div>
            <h2>{{ t('price.warehouse') }}</h2>
            <p>{{ t('price.warehouseSub') }}</p>
          </div>
          <button
            class="ghost-button"
            type="button"
            data-testid="price-warehouse-refresh"
            :disabled="isRefreshingWarehouse || !canRefreshWarehouse"
            @click="refreshWarehouseItems"
          >
            {{ isRefreshingWarehouse ? t('price.refreshingWarehouse') : t('price.refreshWarehouse') }}
          </button>
        </header>
        <p v-if="warehouseError" class="error-text">{{ warehouseError }}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('price.item') }}</th>
                <th>{{ t('price.quality') }}</th>
                <th :aria-sort="getWarehouseAriaSort('occupiedCells')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-warehouse-cells"
                    @click="setWarehouseSort('occupiedCells')"
                  >
                    <span>{{ t('price.warehouseCells') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getWarehouseSortIndicator('occupiedCells') }}</span>
                  </button>
                </th>
                <th :aria-sort="getWarehouseAriaSort('count')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-warehouse-count"
                    @click="setWarehouseSort('count')"
                  >
                    <span>{{ t('price.warehouseCount') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getWarehouseSortIndicator('count') }}</span>
                  </button>
                </th>
                <th :aria-sort="getWarehouseAriaSort('basePrice')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-warehouse-basePrice"
                    @click="setWarehouseSort('basePrice')"
                  >
                    <span>{{ t('price.basePrice') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getWarehouseSortIndicator('basePrice') }}</span>
                  </button>
                </th>
                <th :aria-sort="getWarehouseAriaSort('minPrice')">
                  <button
                    class="sort-header"
                    type="button"
                    data-testid="price-sort-warehouse-minPrice"
                    @click="setWarehouseSort('minPrice')"
                  >
                    <span>{{ t('price.latestPrice') }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ getWarehouseSortIndicator('minPrice') }}</span>
                  </button>
                </th>
                <th>{{ t('price.updatedAt') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!warehouseItems.length">
                <td colspan="7" class="empty-cell">{{ t('price.noWarehouseItems') }}</td>
              </tr>
              <tr
                v-for="item in warehouseItems"
                :key="item.itemCid"
                :data-testid="`warehouse-${item.itemCid}`"
                :class="{ selected: selectedItemCid === item.itemCid }"
                @click="selectItem(item.itemCid)"
              >
                <td>{{ item.name }}</td>
                <td>{{ item.quality }}</td>
                <td :data-testid="`warehouse-cells-${item.itemCid}`">{{ formatNumber(item.occupiedCells) }}</td>
                <td>{{ formatNumber(item.count) }}</td>
                <td>{{ formatNumber(item.basePrice) }}</td>
                <td>{{ formatNumber(item.minPrice) }}</td>
                <td>{{ formatDateTime(item.observedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="search-panel">
        <label>
          <span>{{ t('price.search') }}</span>
          <input v-model="searchText" type="search" :placeholder="t('price.searchPlaceholder')">
        </label>
        <div class="search-results" data-testid="price-search-results">
          <button
            v-for="item in searchResults"
            :key="item.itemCid"
            type="button"
            :class="{ selected: selectedItemCid === item.itemCid }"
            @click="selectItem(item.itemCid)"
          >
            <span>{{ item.name }}</span>
            <strong>{{ item.itemCid }}</strong>
          </button>
          <p v-if="!searchResults.length" class="empty-cell">{{ t('price.noSearchResults') }}</p>
        </div>
      </aside>

      <section class="detail-panel" data-testid="price-detail">
        <header>
          <div>
            <h2>{{ selectedDisplayItem?.name || t('price.history') }}</h2>
            <p>{{ selectedDisplayItem ? `${selectedDisplayItem.itemCid} / ${selectedDisplayItem.quality}` : t('price.noSelection') }}</p>
          </div>
          <button
            v-if="activeTab === 'warehouse' && canListItem"
            class="primary-button"
            type="button"
            data-testid="price-quick-listing"
            :disabled="isQuickListing"
            @click="quickListSelectedItem"
          >
            {{ isQuickListing ? t('price.quickListing.loading') : t('price.quickListing.button') }}
          </button>
          <button
            v-if="canListItem"
            class="primary-button"
            type="button"
            data-testid="price-listing-open"
            :disabled="isQuickListing"
            @click="openListingModal"
          >
            {{ t('price.listing.open') }}
          </button>
          <button
            v-if="selectedItemCid"
            class="ghost-button"
            type="button"
            data-testid="price-item-refresh"
            :disabled="isRefreshingItem || !canRefreshSelectedItem"
            @click="refreshSelectedItem"
          >
            {{ isRefreshingItem ? t('price.refreshingItem') : t('price.refreshItem') }}
          </button>
        </header>

        <p v-if="itemRefreshError" class="error-text">{{ itemRefreshError }}</p>
        <p v-if="listingMessage" class="info-text" data-testid="price-listing-message">{{ listingMessage }}</p>
        <p v-if="quickListingError" class="error-text" data-testid="price-quick-listing-error">{{ quickListingError }}</p>

        <section
          v-if="selectedItemCid && canRefreshWarehouse"
          class="listing-default-config"
          data-testid="price-listing-default-config"
        >
          <label class="listing-default-config-label" for="price-listing-default-percent">
            <span>{{ t('price.listing.defaultPercent') }}</span>
            <small>{{ t('price.listing.defaultPercentHint') }}</small>
          </label>
          <div class="listing-default-config-input">
            <input
              id="price-listing-default-percent"
              v-model="listingDefaultPricePercentInput"
              class="listing-input"
              type="number"
              min="0.01"
              step="0.01"
              data-testid="price-listing-default-percent"
              @blur="normalizeListingDefaultPricePercent"
            >
            <span class="listing-default-config-suffix">%</span>
          </div>
        </section>

        <div v-if="historyStats" class="stat-grid">
          <div>
            <span>{{ t('price.latestPrice') }}</span>
            <strong>{{ formatNumber(historyStats.latest) }}</strong>
          </div>
          <div>
            <span>{{ t('price.lowPrice') }}</span>
            <strong>{{ formatNumber(historyStats.low) }}</strong>
          </div>
          <div>
            <span>{{ t('price.highPrice') }}</span>
            <strong>{{ formatNumber(historyStats.high) }}</strong>
          </div>
          <div>
            <span>{{ t('price.recordCount') }}</span>
            <strong>{{ formatNumber(historyStats.count) }}</strong>
          </div>
        </div>

        <p v-if="selectedItemCid && !selectedHistory.length" class="empty-cell">{{ t('price.noHistory') }}</p>
        <p v-if="!selectedItemCid" class="empty-cell">{{ t('price.noSelection') }}</p>

        <PriceTrendChart
          :history="selectedHistory"
          :axis-time-label="t('price.axisTime')"
          :axis-price-label="t('price.axisPrice')"
          :chart-label="t('price.history')"
          :locale="isEnglish ? 'en-US' : 'zh-CN'"
        />
        <ListingModal
          v-if="isListingModalOpen"
          :item-cid="selectedItemCid"
          :name="selectedDisplayItem?.name || ''"
          :quality="selectedDisplayItem?.quality || ''"
          :owned-count="selectedOwnedCount"
          :default-price-percent="listingDefaultPricePercent"
          @listed="onItemListed"
          @close="closeListingModal"
        />
      </section>
    </section>
  </main>
</template>
