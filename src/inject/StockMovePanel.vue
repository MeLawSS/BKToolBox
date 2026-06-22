<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { buildMoveArgs, findFirstPlacement, sortMovableItems } from './stock-move.js';
import StockMoveListEditorModal from './StockMoveListEditorModal.vue';

const props = defineProps({
  collectibles: {
    type: Array,
    default: () => [],
  },
});

const { t } = useI18n();

const loading = ref(false);
const submitting = ref(false);
const loadError = ref('');
const submitError = ref('');
const containers = ref([]);
const sourceStockId = ref('');
const targetStockId = ref('');
const searchQuery = ref('');
const selectedItemCids = ref([]);
const summary = ref(null);
const sortKey = ref('boxCount');
const sortDirection = ref('desc');
const savedListsLoading = ref(false);
const savedListsError = ref('');
const savedLists = ref([]);
const savedListsRequestId = ref(0);
const isListEditorOpen = ref(false);

const canRunAutoOperationCommand = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ),
);

const canManageSavedLists = computed(() =>
  Boolean(
    canRunAutoOperationCommand.value &&
    typeof window.bidkingDesktop?.listStockMoveLists === 'function' &&
    typeof window.bidkingDesktop?.saveStockMoveList === 'function',
  ),
);

const collectiblesByCid = computed(() => {
  const map = {};
  for (const item of props.collectibles || []) {
    const itemCid = Number(item?.itemCid ?? item?.cid);
    if (Number.isFinite(itemCid) && itemCid > 0) {
      map[itemCid] = item;
    }
  }
  return map;
});

const sourceContainer = computed(() =>
  containers.value.find((container) => String(container.stockId) === sourceStockId.value) || null);

const targetContainer = computed(() =>
  containers.value.find((container) => String(container.stockId) === targetStockId.value) || null);

const sourceItems = computed(() => {
  if (!sourceContainer.value) return [];

  return sourceContainer.value.items
    .filter((item) => {
      const collectible = collectiblesByCid.value[item.itemCid];
      return Boolean(collectible && Array.isArray(item.boxIds) && item.boxIds.length);
    })
    .map((item) => {
      const collectible = collectiblesByCid.value[item.itemCid];
      const width = Number(collectible?.size?.width) || null;
      const height = Number(collectible?.size?.height) || null;
      const sizeText = collectible?.size?.key || (width && height ? `${width}x${height}` : '-');
      const sizeArea = width && height ? width * height : item.boxCount;
      const searchText = [
        collectible?.name,
        collectible?.quality,
        collectible?.type,
        item.itemCid,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return {
        ...item,
        collectible,
        searchText,
        sizeText,
        sizeArea,
      };
    });
});

const sourceGroups = computed(() => {
  const groups = new Map();

  for (const item of sourceItems.value) {
    let group = groups.get(item.itemCid);
    if (!group) {
      group = {
        itemCid: item.itemCid,
        collectible: item.collectible,
        sizeText: item.sizeText,
        sizeArea: item.sizeArea,
        boxCount: item.boxCount,
        count: 0,
        items: [],
        searchText: item.searchText,
      };
      groups.set(item.itemCid, group);
    }

    group.count += 1;
    group.items.push(item);
  }

  return [...groups.values()].sort(compareSourceGroups);
});

const visibleSourceGroups = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return sourceGroups.value;
  return sourceGroups.value.filter((group) => group.searchText.includes(query));
});

function compareNumberValues(left, right, direction = 'asc') {
  const difference = Number(left) - Number(right);
  if (difference === 0) return 0;
  return direction === 'asc' ? difference : -difference;
}

function compareTextValues(left, right, direction = 'asc') {
  const difference = String(left || '').localeCompare(String(right || ''));
  if (difference === 0) return 0;
  return direction === 'asc' ? difference : -difference;
}

function compareDefaultSourceGroups(left, right) {
  const boxCountCompare = compareNumberValues(left.boxCount, right.boxCount, 'desc');
  if (boxCountCompare !== 0) return boxCountCompare;

  const nameCompare = compareTextValues(left.collectible?.name, right.collectible?.name, 'asc');
  if (nameCompare !== 0) return nameCompare;

  return compareNumberValues(left.itemCid, right.itemCid, 'asc');
}

function compareSourceGroupsByKey(left, right) {
  switch (sortKey.value) {
    case 'name':
      return compareTextValues(left.collectible?.name, right.collectible?.name, sortDirection.value);
    case 'quality':
      return compareTextValues(left.collectible?.quality, right.collectible?.quality, sortDirection.value);
    case 'type':
      return compareTextValues(left.collectible?.type, right.collectible?.type, sortDirection.value);
    case 'itemCid':
      return compareNumberValues(left.itemCid, right.itemCid, sortDirection.value);
    case 'size': {
      const areaCompare = compareNumberValues(left.sizeArea, right.sizeArea, sortDirection.value);
      if (areaCompare !== 0) return areaCompare;
      return compareTextValues(left.sizeText, right.sizeText, sortDirection.value);
    }
    case 'count':
      return compareNumberValues(left.count, right.count, sortDirection.value);
    case 'boxCount':
      return compareNumberValues(left.boxCount, right.boxCount, sortDirection.value);
    default:
      return 0;
  }
}

function compareSourceGroups(left, right) {
  const keyCompare = compareSourceGroupsByKey(left, right);
  if (keyCompare !== 0) return keyCompare;
  return compareDefaultSourceGroups(left, right);
}

function setSourceGroupSort(nextKey) {
  if (sortKey.value === nextKey) {
    sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc';
    return;
  }
  sortKey.value = nextKey;
  sortDirection.value = 'desc';
}

function getSourceGroupAriaSort(key) {
  if (sortKey.value !== key) return 'none';
  return sortDirection.value === 'asc' ? 'ascending' : 'descending';
}

function getSourceGroupSortIndicator(key) {
  if (sortKey.value !== key) return '';
  return sortDirection.value === 'desc' ? '↓' : '↑';
}

const canSubmit = computed(() =>
  Boolean(
    canRunAutoOperationCommand.value &&
    !submitting.value &&
    sourceContainer.value &&
    targetContainer.value &&
    sourceStockId.value &&
    targetStockId.value &&
    sourceStockId.value !== targetStockId.value &&
    selectedItemCids.value.length,
  ),
);

const selectedDraftItems = computed(() =>
  selectedItemCids.value
    .map((itemCid) => collectiblesByCid.value[Number(itemCid)] || null)
    .filter(Boolean),
);

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toStockId(value, fallback = null) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) {
    return number;
  }
  return fallback;
}

function makeCells(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({ boxId: y * width + x, x, y });
    }
  }
  return cells;
}

function normalizeItem(item, container) {
  const boxIds = Array.isArray(item?.boxIds)
    ? item.boxIds
      .map((boxId) => toNumber(boxId, -1))
      .filter((boxId) => boxId >= 0)
      .sort((left, right) => left - right)
    : [];

  return {
    itemUid: String(item?.itemUid ?? ''),
    itemId: toNumber(item?.itemId ?? item?.itemCid),
    itemCid: toNumber(item?.itemCid ?? item?.itemId),
    count: Math.max(1, toNumber(item?.count, 1)),
    pos: toNumber(item?.pos, boxIds[0] ?? 0),
    rotate: Boolean(item?.rotate),
    stockId: toStockId(item?.stockId, container.stockId),
    boxCount: Math.max(1, toNumber(item?.boxCount, boxIds.length || 1)),
    boxIds,
    canTrade: Boolean(item?.canTrade ?? item?.canSale),
    canSale: Boolean(item?.canSale ?? item?.canTrade),
    isLock: Boolean(item?.isLock),
  };
}

function normalizeContainers(payload) {
  const input = Array.isArray(payload?.containers)
    ? payload.containers
    : Array.isArray(payload)
      ? payload
      : [];

  return input
    .map((container) => {
      const width = toNumber(container?.width);
      const height = toNumber(container?.height);
      if (width <= 0 || height <= 0) return null;
      const stockId = toStockId(container?.stockId);
      if (stockId === null) return null;
      const normalized = {
        stockId,
        stockCid: toNumber(container?.stockCid),
        width,
        height,
        boxCount: Math.max(1, toNumber(container?.boxCount, width * height)),
        cells: makeCells(width, height),
      };
      normalized.items = Array.isArray(container?.items)
        ? container.items
          .map((item) => normalizeItem(item, normalized))
          .filter((item) => item.itemUid && item.stockId !== null)
        : [];
      return normalized;
    })
    .filter(Boolean)
    .sort((left, right) => left.stockId - right.stockId);
}

function formatContainerLabel(container) {
  return `#${container.stockId} · ${container.width}x${container.height} · ${container.items.length}`;
}

function createSummaryState(overrides = {}) {
  return {
    total: 0,
    processedCount: 0,
    successCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentItemLabel: '',
    stopReason: '',
    ...overrides,
  };
}

function getItemLabel(item) {
  return item?.collectible?.name || t('inject.stockMoveUnknownItem');
}

function resetSummary() {
  summary.value = null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSavedListItemCids(savedList) {
  const itemCids = [];
  const seen = new Set();

  for (const value of Array.isArray(savedList?.itemCids) ? savedList.itemCids : []) {
    const itemCid = Number(value);
    if (!Number.isInteger(itemCid) || itemCid <= 0 || seen.has(itemCid)) continue;
    seen.add(itemCid);
    itemCids.push(itemCid);
  }

  return itemCids;
}

function getSavedListMatchCount(savedList) {
  const available = new Set(sourceGroups.value.map((group) => group.itemCid));
  return getSavedListItemCids(savedList).filter((itemCid) => available.has(itemCid)).length;
}

function getSavedListKindCount(savedList) {
  return Array.isArray(savedList?.itemCids) ? savedList.itemCids.length : 0;
}

async function refreshSavedLists() {
  if (!canManageSavedLists.value) return;

  const requestId = savedListsRequestId.value + 1;
  savedListsRequestId.value = requestId;
  savedListsLoading.value = true;
  savedListsError.value = '';

  try {
    const response = await window.bidkingDesktop.listStockMoveLists();
    if (requestId !== savedListsRequestId.value) return;
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    savedLists.value = Array.isArray(response?.value) ? response.value : [];
  } catch (error) {
    if (requestId !== savedListsRequestId.value) return;
    savedListsError.value = error?.message || t('inject.failed');
  } finally {
    if (requestId !== savedListsRequestId.value) return;
    savedListsLoading.value = false;
  }
}

function applySavedList(savedList) {
  const available = new Set(sourceGroups.value.map((group) => group.itemCid));
  const nextSelection = getSavedListItemCids(savedList).filter((itemCid) => available.has(itemCid));

  if (!nextSelection.length) {
    savedListsError.value = t('inject.stockMoveSavedListNoMatches');
    return;
  }

  selectedItemCids.value = nextSelection;
  savedListsError.value = '';
  submitError.value = '';
  resetSummary();
}

function clearSelection() {
  selectedItemCids.value = [];
  submitError.value = '';
  resetSummary();
}

function invertSelection() {
  const visibleCids = new Set(visibleSourceGroups.value.map((g) => g.itemCid));
  const currentSet = new Set(selectedItemCids.value);
  const hiddenSelected = selectedItemCids.value.filter((cid) => !visibleCids.has(cid));
  const visibleUnselected = [...new Set(
    visibleSourceGroups.value
      .filter((g) => !currentSet.has(g.itemCid))
      .map((g) => g.itemCid),
  )];
  selectedItemCids.value = [...hiddenSelected, ...visibleUnselected];
  submitError.value = '';
  resetSummary();
}

function selectAllItems() {
  selectedItemCids.value = visibleSourceGroups.value.map((group) => group.itemCid);
  submitError.value = '';
  resetSummary();
}

function openListEditor() {
  savedListsError.value = '';
  isListEditorOpen.value = true;
}

function closeListEditor() {
  isListEditorOpen.value = false;
}

async function handleListEditorSaved() {
  closeListEditor();
  await refreshSavedLists();
}

async function loadStockContainers() {
  if (!canRunAutoOperationCommand.value || loading.value) return;

  loading.value = true;
  loadError.value = '';
  submitError.value = '';
  resetSummary();

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand('GetStockContainers', {});
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    const nextContainers = normalizeContainers(response?.value ?? response);
    if (!nextContainers.length) {
      throw new Error(t('inject.failed'));
    }
    containers.value = nextContainers;
    selectedItemCids.value = [];
    if (!nextContainers.some((container) => String(container.stockId) === sourceStockId.value)) {
      sourceStockId.value = '';
    }
    if (!nextContainers.some((container) => String(container.stockId) === targetStockId.value)) {
      targetStockId.value = '';
    }
    await refreshSavedLists();
  } catch (error) {
    loadError.value = error?.message || t('inject.failed');
  } finally {
    loading.value = false;
  }
}

async function moveSelectedItems() {
  if (!canSubmit.value) return;

  const selectedCidSet = new Set(selectedItemCids.value);
  const sourceId = Number(sourceStockId.value);
  const destinationId = Number(targetStockId.value);
  let currentContainers = containers.value;
  let totalSelectedCount = 0;
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let moveCommandCount = 0;
  let stopReason = '';

  submitting.value = true;
  submitError.value = '';
  resetSummary();

  const syncSummary = (overrides = {}) => {
    summary.value = createSummaryState({
      ...(summary.value || {}),
      total: totalSelectedCount,
      processedCount: successCount + skippedCount + failedCount,
      successCount,
      skippedCount,
      failedCount,
      stopReason,
      ...overrides,
    });
  };

  try {
    const startingSource = currentContainers.find((container) => container.stockId === sourceId);
    if (!startingSource) throw new Error(t('inject.failed'));

    const orderedItems = sortMovableItems(
      sourceItems.value.filter((item) => selectedCidSet.has(item.itemCid)),
    );
    totalSelectedCount = orderedItems.length;
    syncSummary({
      currentItemLabel: orderedItems[0] ? getItemLabel(orderedItems[0]) : '',
    });

    for (const selectedItem of orderedItems) {
      const currentItemLabel = getItemLabel(selectedItem);
      syncSummary({ currentItemLabel });

      const liveSource = currentContainers.find((container) => container.stockId === sourceId);
      const liveTarget = currentContainers.find((container) => container.stockId === destinationId);
      const liveItem = liveSource?.items.find((item) => item.itemUid === selectedItem.itemUid) || null;

      if (!liveTarget || !liveItem || !Array.isArray(liveItem.boxIds) || !liveItem.boxIds.length) {
        skippedCount += 1;
        syncSummary({ currentItemLabel });
        continue;
      }

      const placement = findFirstPlacement(liveTarget, liveSource, liveItem);
      if (!placement) {
        skippedCount += 1;
        syncSummary({ currentItemLabel });
        continue;
      }

      if (moveCommandCount > 0 && totalSelectedCount > 1) {
        await delay(1000);
      }

      const args = buildMoveArgs({
        sourceItem: liveItem,
        targetStockId: destinationId,
        placement,
      });
      try {
        const response = await window.bidkingDesktop.runAutoOperationCommand('MoveStockItem', args);
        if (response?.ok === false) {
          throw new Error(response.error || t('inject.failed'));
        }
        const nextContainers = normalizeContainers(response?.value ?? response);
        if (!nextContainers.length) {
          throw new Error(t('inject.failed'));
        }
        currentContainers = nextContainers;
        moveCommandCount += 1;
        successCount += 1;
        syncSummary({ currentItemLabel });
      } catch (error) {
        failedCount += 1;
        stopReason = error?.message || t('inject.failed');
        submitError.value = stopReason;
        syncSummary({ currentItemLabel });
        throw error;
      }
    }

    containers.value = currentContainers;
    selectedItemCids.value = [];
    syncSummary({ currentItemLabel: '' });
  } catch (error) {
    if (!stopReason) {
      stopReason = error?.message || t('inject.failed');
      submitError.value = stopReason;
      syncSummary();
    }
  } finally {
    submitting.value = false;
  }
}

watch(sourceStockId, () => {
  selectedItemCids.value = [];
  savedListsError.value = '';
  submitError.value = '';
  resetSummary();
});

watch(targetStockId, () => {
  submitError.value = '';
  resetSummary();
});

onMounted(() => {
  refreshSavedLists();
});
</script>

<template>
  <section
    v-if="canRunAutoOperationCommand"
    class="listing-advice-panel warehouse-panel"
    data-testid="stock-move-panel"
  >
    <header class="section-head listing-advice-head">
      <div>
        <h2>{{ t('inject.stockMoveTitle') }}</h2>
        <p>{{ t('inject.stockMoveDescription') }}</p>
      </div>
      <button
        class="command-button"
        type="button"
        data-testid="stock-move-load"
        :disabled="loading"
        @click="loadStockContainers"
      >
        {{ loading ? t('inject.stockMoveLoading') : t('inject.stockMoveLoad') }}
      </button>
    </header>

    <p v-if="loadError" class="status-text is-error">
      {{ loadError }}
    </p>
    <p v-if="submitError" class="status-text is-error">
      {{ submitError }}
    </p>

    <div class="auto-op-fields stock-move-fields">
      <label>
        <span>{{ t('inject.stockMoveSource') }}</span>
        <select v-model="sourceStockId" class="stock-move-select" data-testid="stock-move-source">
          <option value="" />
          <option
            v-for="container in containers"
            :key="`source-${container.stockId}`"
            :value="String(container.stockId)"
          >
            {{ formatContainerLabel(container) }}
          </option>
        </select>
      </label>
      <label>
        <span>{{ t('inject.stockMoveTarget') }}</span>
        <select v-model="targetStockId" class="stock-move-select" data-testid="stock-move-target">
          <option value="" />
          <option
            v-for="container in containers"
            :key="`target-${container.stockId}`"
            :value="String(container.stockId)"
          >
            {{ formatContainerLabel(container) }}
          </option>
        </select>
      </label>
      <label>
        <span>{{ t('price.search') }}</span>
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('inject.stockMoveSearchPlaceholder')"
          data-testid="stock-move-search"
        />
      </label>
      <div class="action-row stock-move-toolbar-actions">
        <button
          class="command-button stock-move-secondary-button stock-move-secondary-button--compact"
          type="button"
          data-testid="stock-move-select-all"
          :disabled="!visibleSourceGroups.length"
          @click="selectAllItems"
        >
          {{ t('inject.stockMoveSelectAll') }}
        </button>
        <button
          class="command-button stock-move-secondary-button stock-move-secondary-button--compact"
          type="button"
          data-testid="stock-move-clear"
          :disabled="!selectedItemCids.length"
          @click="clearSelection"
        >
          {{ t('inject.stockMoveClear') }}
        </button>
        <button
          class="command-button stock-move-secondary-button stock-move-secondary-button--compact"
          type="button"
          data-testid="stock-move-invert"
          :disabled="!visibleSourceGroups.length"
          @click="invertSelection"
        >
          {{ t('inject.stockMoveInvert') }}
        </button>
      </div>
      <button
        class="primary-button"
        type="button"
        data-testid="stock-move-submit"
        :disabled="!canSubmit"
        @click="moveSelectedItems"
      >
        {{ submitting ? t('inject.stockMoveSubmitting') : t('inject.stockMoveSubmit') }}
      </button>
    </div>

    <section v-if="canManageSavedLists" class="warehouse-table-wrap">
      <header class="section-head listing-advice-head">
        <div>
          <h3>{{ t('inject.stockMoveSavedLists') }}</h3>
        </div>
        <button
          class="command-button stock-move-secondary-button stock-move-secondary-button--compact"
          type="button"
          data-testid="stock-move-open-list-editor"
          @click="openListEditor"
        >
          {{ t('inject.stockMoveCreateList') }}
        </button>
      </header>

      <p v-if="savedListsError" class="status-text is-error" data-testid="stock-move-saved-lists-error">
        {{ savedListsError }}
      </p>

      <div v-if="savedLists.length" class="collection-scan-status">
        <div
          v-for="savedList in savedLists"
          :key="savedList.id || savedList.name"
          class="stock-move-saved-list-row"
        >
          <div class="stock-move-saved-list-meta">
            <strong class="stock-move-saved-list-name">{{ savedList.name || '-' }}</strong>
            <span>{{ t('inject.stockMoveSavedKinds') }}</span>
            <strong :data-testid="`stock-move-saved-list-kind-${savedList.id}`">
              {{ getSavedListKindCount(savedList) }}
            </strong>
            <span>{{ t('inject.stockMoveSavedAt') }}</span>
            <strong :data-testid="`stock-move-saved-list-time-${savedList.id}`">
              {{ savedList.savedAt || '-' }}
            </strong>
            <span>{{ t('inject.stockMoveSavedMatches') }}</span>
            <strong :data-testid="`stock-move-saved-list-match-${savedList.id}`">
              {{ getSavedListMatchCount(savedList) }}
            </strong>
          </div>
          <button
            class="command-button stock-move-secondary-button stock-move-secondary-button--compact stock-move-saved-list-apply"
            type="button"
            :data-testid="`stock-move-apply-list-${savedList.id}`"
            :disabled="savedListsLoading"
            @click="applySavedList(savedList)"
          >
            {{ t('inject.stockMoveApplyList') }}
          </button>
        </div>
      </div>

      <p v-else-if="!savedListsLoading" class="empty-cell">
        {{ t('inject.stockMoveNoSavedLists') }}
      </p>
    </section>

    <StockMoveListEditorModal
      v-if="isListEditorOpen"
      :collectibles="collectibles"
      :initial-draft-items="selectedDraftItems"
      :current-selected-items="selectedDraftItems"
      @close="closeListEditor"
      @saved="handleListEditorSaved"
    />

    <div class="warehouse-table-wrap">
      <table class="warehouse-table">
        <thead>
          <tr>
            <th />
            <th :aria-sort="getSourceGroupAriaSort('name')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-name"
                @click="setSourceGroupSort('name')"
              >
                <span>{{ t('inject.warehouseItemName') }}</span>
                <span v-if="getSourceGroupSortIndicator('name')" class="warehouse-sort-indicator" aria-hidden="true">
                  {{ getSourceGroupSortIndicator('name') }}
                </span>
              </button>
            </th>
            <th :aria-sort="getSourceGroupAriaSort('quality')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-quality"
                @click="setSourceGroupSort('quality')"
              >
                <span>{{ t('inject.warehouseItemQuality') }}</span>
                <span
                  v-if="getSourceGroupSortIndicator('quality')"
                  class="warehouse-sort-indicator"
                  aria-hidden="true"
                >
                  {{ getSourceGroupSortIndicator('quality') }}
                </span>
              </button>
            </th>
            <th :aria-sort="getSourceGroupAriaSort('type')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-type"
                @click="setSourceGroupSort('type')"
              >
                <span>{{ t('inject.warehouseItemType') }}</span>
                <span v-if="getSourceGroupSortIndicator('type')" class="warehouse-sort-indicator" aria-hidden="true">
                  {{ getSourceGroupSortIndicator('type') }}
                </span>
              </button>
            </th>
            <th :aria-sort="getSourceGroupAriaSort('itemCid')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-itemCid"
                @click="setSourceGroupSort('itemCid')"
              >
                <span>{{ t('inject.warehouseItemCid') }}</span>
                <span
                  v-if="getSourceGroupSortIndicator('itemCid')"
                  class="warehouse-sort-indicator"
                  aria-hidden="true"
                >
                  {{ getSourceGroupSortIndicator('itemCid') }}
                </span>
              </button>
            </th>
            <th :aria-sort="getSourceGroupAriaSort('size')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-size"
                @click="setSourceGroupSort('size')"
              >
                <span>{{ t('inject.stockMoveSize') }}</span>
                <span v-if="getSourceGroupSortIndicator('size')" class="warehouse-sort-indicator" aria-hidden="true">
                  {{ getSourceGroupSortIndicator('size') }}
                </span>
              </button>
            </th>
            <th :aria-sort="getSourceGroupAriaSort('count')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-count"
                @click="setSourceGroupSort('count')"
              >
                <span>{{ t('inject.warehouseItemCount') }}</span>
                <span v-if="getSourceGroupSortIndicator('count')" class="warehouse-sort-indicator" aria-hidden="true">
                  {{ getSourceGroupSortIndicator('count') }}
                </span>
              </button>
            </th>
            <th :aria-sort="getSourceGroupAriaSort('boxCount')">
              <button
                class="warehouse-sort-button"
                type="button"
                data-testid="stock-move-sort-boxCount"
                @click="setSourceGroupSort('boxCount')"
              >
                <span>{{ t('inject.stockMoveCells') }}</span>
                <span
                  v-if="getSourceGroupSortIndicator('boxCount')"
                  class="warehouse-sort-indicator"
                  aria-hidden="true"
                >
                  {{ getSourceGroupSortIndicator('boxCount') }}
                </span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!visibleSourceGroups.length">
            <td colspan="8" class="empty-cell">{{ t('inject.warehouseItemsEmpty') }}</td>
          </tr>
          <tr
            v-for="group in visibleSourceGroups"
            :key="group.itemCid"
            :data-testid="`stock-move-row-group-${group.itemCid}`"
          >
            <td>
              <input
                v-model="selectedItemCids"
                type="checkbox"
                :value="group.itemCid"
                :data-testid="`stock-move-item-group-${group.itemCid}`"
              />
            </td>
            <td>{{ group.collectible?.name || t('inject.stockMoveUnknownItem') }}</td>
            <td>{{ group.collectible?.quality || '-' }}</td>
            <td>{{ group.collectible?.type || '-' }}</td>
            <td>{{ group.itemCid }}</td>
            <td>{{ group.sizeText }}</td>
            <td>{{ group.count }}</td>
            <td>{{ group.boxCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="summary" class="collection-scan-status" data-testid="stock-move-summary">
      <span>{{ t('inject.stockMoveProcessed') }}</span>
      <strong data-testid="stock-move-summary-processed">{{ summary.processedCount }}</strong>
      <span>{{ t('inject.stockMoveTotal') }}</span>
      <strong data-testid="stock-move-summary-total">{{ summary.total }}</strong>
      <span>{{ t('inject.stockMoveSuccess') }}</span>
      <strong data-testid="stock-move-summary-success">{{ summary.successCount }}</strong>
      <span>{{ t('inject.stockMoveSkipped') }}</span>
      <strong data-testid="stock-move-summary-skipped">{{ summary.skippedCount }}</strong>
      <span>{{ t('inject.stockMoveFailed') }}</span>
      <strong data-testid="stock-move-summary-failed">{{ summary.failedCount }}</strong>
      <span>{{ t('inject.stockMoveCurrentItem') }}</span>
      <strong data-testid="stock-move-summary-current-item">{{ summary.currentItemLabel || '-' }}</strong>
      <span>{{ t('inject.stockMoveStopReason') }}</span>
      <strong data-testid="stock-move-summary-stop-reason">{{ summary.stopReason || '-' }}</strong>
    </div>
  </section>
</template>
