<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import TopBar from '../shared/TopBar.vue';
import { useI18n } from '../shared/i18n.js';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';

const DEFAULT_REMOTE = '';
const DEFAULT_PORT = 10000;
const DEFAULT_BATCH_SECONDS = 2;
const MAX_EVENTS = 500;

const { t, isEnglish } = useI18n();
const monitor = useMonitorSwitch();

const form = reactive({
  remoteAddress: DEFAULT_REMOTE,
  port: DEFAULT_PORT,
  batchSeconds: DEFAULT_BATCH_SECONDS,
  gameRoot: '',
  outputDir: '',
});
const status = monitor.status;
const driverStatus = ref({ state: 'unknown', installed: false, usable: false });
const events = ref([]);
const selectedKey = ref('');
const filterText = ref('');
const fullOnly = ref(false);
const qualityOnly = ref(false);
const aggregateOnly = ref(false);
const marketPrices = ref([]);
const collectiblesByCid = ref({});
const selectedMarketItemCid = ref(null);
const marketHistory = ref([]);
const actionError = ref('');
const driverActionMessage = ref('');
const driverActionPending = ref('');
let removeMonitorSubscription = null;
let removeMonitorStartOptionsResolver = null;
let marketHistoryRequestId = 0;
const statusText = monitor.statusText;
const driverStatusText = computed(() => t(`monitor.driver.states.${driverStatus.value.state || 'unknown'}`));
const selectedEvent = computed(() => events.value.find((event) => getEventUiKey(event) === selectedKey.value) || events.value[0] || null);
const selectedMarketPrice = computed(() =>
  marketPrices.value.find((item) => item.itemCid === selectedMarketItemCid.value) || marketPrices.value[0] || null
);
const latestMarketTiers = computed(() => marketHistory.value.at(-1)?.tiers || []);
const filteredEvents = computed(() => {
  const query = filterText.value.trim().toLowerCase();
  return events.value.filter((event) => {
    const rawEvent = getRawEvent(event);
    const skill = rawEvent.skill || {};
    if (fullOnly.value && !hasFullItems(event)) return false;
    if (qualityOnly.value && !hasQualityOnlyItems(event)) return false;
    if (aggregateOnly.value && hasFullItems(event)) return false;
    if (!query) return true;
    return [
      event.key,
      rawEvent.key,
      rawEvent.sourceKind,
      rawEvent.msgId,
      event.gameUid ?? rawEvent.gameUid,
      rawEvent.round,
      rawEvent.group,
      skill.skillCid,
      skill.itemCid,
      skill.itemName,
      getPrimaryItemName(event),
      getQuality(event),
    ].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
});

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '-';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(isEnglish.value ? 'en-US' : 'zh-CN');
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

async function fetchDriverStatus() {
  try {
    const response = await fetch('/api/capture-driver/status');
    if (!response.ok) throw new Error(await response.text());
    driverStatus.value = await response.json();
  } catch (error) {
    actionError.value = getErrorMessage(error);
    driverStatus.value = { state: 'error', installed: false, usable: false, message: getErrorMessage(error) };
  }
}

async function fetchMarketPrices() {
  try {
    const response = await fetch('/api/market-prices/latest');
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    marketPrices.value = Array.isArray(payload.items) ? payload.items : [];
    if (!marketPrices.value.some((item) => item.itemCid === selectedMarketItemCid.value)) {
      selectedMarketItemCid.value = marketPrices.value[0]?.itemCid ?? null;
    }
    if (selectedMarketItemCid.value) {
      await fetchMarketHistory(selectedMarketItemCid.value);
    } else {
      marketHistory.value = [];
    }
  } catch (error) {
    actionError.value = getErrorMessage(error);
  }
}

function getCollectibleCid(collectible) {
  const explicitCid = collectible?.itemCid ?? collectible?.cid ?? collectible?.id;
  if (explicitCid !== undefined && explicitCid !== null && explicitCid !== '') return Number(explicitCid);
  const match = String(collectible?.image || '').match(/icon_(\d+)\.png/);
  return match ? Number(match[1]) : null;
}

async function fetchCollectibles() {
  try {
    const response = await fetch('/data/collectibles.json');
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const nextMap = {};
    for (const collectible of Array.isArray(payload) ? payload : []) {
      const cid = getCollectibleCid(collectible);
      if (Number.isFinite(cid)) nextMap[cid] = collectible;
    }
    collectiblesByCid.value = nextMap;
  } catch (error) {
    actionError.value = getErrorMessage(error);
  }
}

function getCollectibleNameByCid(itemCid) {
  const cid = Number(itemCid);
  return Number.isFinite(cid) ? collectiblesByCid.value[cid]?.name : undefined;
}

function getMarketItemName(item) {
  return item?.itemName || getCollectibleNameByCid(item?.itemCid) || item?.itemCid || '-';
}

async function fetchMarketHistory(itemCid) {
  if (!itemCid) return;
  const requestedItemCid = Number(itemCid);
  const requestId = ++marketHistoryRequestId;
  try {
    const response = await fetch(`/api/market-prices/history?itemCid=${encodeURIComponent(itemCid)}&limit=50`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    if (requestId === marketHistoryRequestId && selectedMarketItemCid.value === requestedItemCid) {
      marketHistory.value = Array.isArray(payload.history) ? payload.history : [];
    }
  } catch (error) {
    if (requestId === marketHistoryRequestId) {
      actionError.value = getErrorMessage(error);
    }
  }
}

async function selectMarketPrice(item) {
  selectedMarketItemCid.value = item.itemCid;
  marketHistory.value = [];
  await fetchMarketHistory(item.itemCid);
}

async function runDriverAction(action) {
  actionError.value = '';
  driverActionMessage.value = '';
  driverActionPending.value = action;
  try {
    const response = await fetch(`/api/capture-driver/${action}`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || response.statusText);
    }
    await response.json();
    driverActionMessage.value = action === 'install'
      ? t('monitor.driver.installStarted')
      : t('monitor.driver.uninstallStarted');
    await fetchDriverStatus();
  } catch (error) {
    actionError.value = getErrorMessage(error);
  } finally {
    driverActionPending.value = '';
  }
}

function installDriver() {
  return runDriverAction('install');
}

function uninstallDriver() {
  return runDriverAction('uninstall');
}

function buildMonitorStartPayload() {
  return {
    remoteAddress: form.remoteAddress.trim(),
    port: Number(form.port),
    batchSeconds: Number(form.batchSeconds),
    gameRoot: form.gameRoot.trim(),
    outputDir: form.outputDir.trim(),
  };
}

async function startMonitor() {
  actionError.value = '';
  const payload = buildMonitorStartPayload();

  try {
    await monitor.startMonitor(payload);
  } catch (_error) {}
}

async function stopMonitor() {
  actionError.value = '';
  try {
    await monitor.stopMonitor();
  } catch (_error) {}
}

function pushEvent(event) {
  const rawEvent = getRawEvent(event);
  const isMarketPriceEvent = rawEvent?.type === 'market_price';
  const eventUiKey = getEventUiKey(event);
  if (!eventUiKey || events.value.some((existing) => getEventUiKey(existing) === eventUiKey)) {
    if (isMarketPriceEvent) fetchMarketPrices();
    return;
  }
  events.value = [event, ...events.value].slice(0, MAX_EVENTS);
  if (!selectedKey.value) {
    selectedKey.value = eventUiKey;
  }
  if (isMarketPriceEvent) {
    fetchMarketPrices();
  }
}

function selectEvent(event) {
  selectedKey.value = getEventUiKey(event);
}

function clearEvents() {
  events.value = [];
  selectedKey.value = '';
}

function getRawEvent(event) {
  return event?.rawEvent ?? event;
}

function getEventUiKey(event) {
  const rawEvent = getRawEvent(event);
  const key = event?.key ?? rawEvent?.key;
  if (!key) return '';
  const gameUid = event?.gameUid ?? rawEvent?.gameUid;
  return gameUid === undefined || gameUid === null || gameUid === ''
    ? String(key)
    : `${gameUid}:${key}`;
}

function hasFullItems(event) {
  return getHitBoxes(event).some((box) => box.itemCid || getBoxItemName(box) !== '-' || getBoxPrice(box) !== undefined);
}

function hasQualityOnlyItems(event) {
  const skill = getRawEvent(event)?.skill || {};
  return Boolean(skill.qualityOnlyHitBoxCount) || getHitBoxes(event).some((box) => getBoxQuality(box) !== '-' && !box.itemCid);
}

function getHitBoxes(event) {
  const skill = getRawEvent(event)?.skill || {};
  if (Array.isArray(skill.hitBoxes)) return skill.hitBoxes;
  if (Array.isArray(skill.hitBoxList)) return skill.hitBoxList;
  return [];
}

function getBoxItemName(box) {
  return box.name || box.itemName || '-';
}

function getBoxQuality(box) {
  return box.quality || box.itemQuilityName || box.itemQualityName || '-';
}

function getBoxPosition(box, index) {
  return box.boxIndex ?? box.boxId ?? box.index ?? index;
}

function getBoxPrice(box) {
  return box.price ?? box.itemPrice;
}

function getBoxSize(box) {
  const width = box.width ?? box.itemWidth;
  const height = box.height ?? box.itemHeight;
  if (width && height) return `${width}x${height}`;
  if (box.itemBoxIndex) return formatNumber(box.itemBoxIndex);
  return '-';
}

function getPrimaryItemName(event) {
  const rawEvent = getRawEvent(event);
  if (rawEvent?.type === 'market_price') {
    return rawEvent.itemName || getCollectibleNameByCid(rawEvent.itemCid) || (rawEvent.itemCid ? `#${rawEvent.itemCid}` : '-');
  }
  const skill = getRawEvent(event)?.skill || {};
  const boxName = getHitBoxes(event).map(getBoxItemName).find((name) => name !== '-');
  return skill.itemName || boxName || '-';
}

function getQuality(event) {
  const skill = getRawEvent(event)?.skill || {};
  const boxQualities = [...new Set(getHitBoxes(event).map(getBoxQuality).filter((quality) => quality !== '-'))];
  return skill.quality || skill.qualities?.join('/') || skill.hitItemQuilityNames?.join('/') || boxQualities.join('/') || '-';
}

function getHitSummary(event) {
  const skill = getRawEvent(event)?.skill || {};
  const hitBoxes = getHitBoxes(event);
  if (hitBoxes.length) return `${hitBoxes.length}/${formatNumber(skill.hitBoxCount || hitBoxes.length)}`;
  if (skill.hitBoxCount) return formatNumber(skill.hitBoxCount);
  if (Array.isArray(skill.hitCells)) return formatNumber(skill.hitCells.length);
  if (skill.allHitItemAvgBoxIndex !== undefined) return `${t('monitor.metrics.avgCells')} ${formatNumber(skill.allHitItemAvgBoxIndex)}`;
  return '-';
}

function getPriceSummary(event) {
  const skill = getRawEvent(event)?.skill || {};
  if (skill.hitPrice ?? skill.hitItemTotalPrice) return formatNumber(skill.hitPrice ?? skill.hitItemTotalPrice);
  if (skill.allHitItemAvgPrice !== undefined) return `${t('monitor.metrics.avgItemPrice')} ${formatNumber(skill.allHitItemAvgPrice)}`;
  if (skill.allHitBoxAvgPrice !== undefined) return `${t('monitor.metrics.avgBoxPrice')} ${formatNumber(skill.allHitBoxAvgPrice)}`;
  const prices = getHitBoxes(event).map((box) => Number(getBoxPrice(box))).filter(Number.isFinite);
  return prices.length ? formatNumber(prices.reduce((sum, price) => sum + price, 0)) : '-';
}

function getDetailRows(event) {
  const hitBoxes = getHitBoxes(event);
  return hitBoxes.map((box, index) => ({
    id: `${getEventUiKey(event)}-${index}`,
    box: getBoxPosition(box, index),
    item: getBoxItemName(box) !== '-' ? getBoxItemName(box) : `#${box.itemCid || '-'}`,
    quality: getBoxQuality(box),
    size: getBoxSize(box),
    price: formatNumber(getBoxPrice(box)),
  }));
}

function getMetricRows(event) {
  const skill = getRawEvent(event)?.skill || {};
  return [
    skill.allHitItemAvgBoxIndex !== undefined
      ? { key: 'avg-cells', label: t('monitor.metrics.avgCells'), value: formatNumber(skill.allHitItemAvgBoxIndex) }
      : null,
    skill.allHitItemAvgPrice !== undefined
      ? { key: 'avg-item-price', label: t('monitor.metrics.avgItemPrice'), value: formatNumber(skill.allHitItemAvgPrice) }
      : null,
    skill.allHitBoxAvgPrice !== undefined
      ? { key: 'avg-box-price', label: t('monitor.metrics.avgBoxPrice'), value: formatNumber(skill.allHitBoxAvgPrice) }
      : null,
    skill.totalHitBoxIndex !== undefined
      ? { key: 'hit-cells', label: t('monitor.metrics.hitCells'), value: formatNumber(skill.totalHitBoxIndex) }
      : null,
    skill.hitItemTotalPrice !== undefined
      ? { key: 'hit-price', label: t('monitor.metrics.hitPrice'), value: formatNumber(skill.hitItemTotalPrice) }
      : null,
  ].filter(Boolean);
}

function getEventFacts(event) {
  return Array.isArray(event?.facts) ? event.facts : [];
}

function getEventState(event) {
  return event?.state ?? null;
}

onMounted(() => {
  void monitor.refreshStatus().catch(() => {});
  monitor.ensureStreamConnected();
  removeMonitorStartOptionsResolver = monitor.setStartOptionsResolver(buildMonitorStartPayload);
  removeMonitorSubscription = monitor.subscribe((message) => {
    if (!message || message.kind !== 'event') return;
    pushEvent(message.payload);
  });
  fetchDriverStatus();
  fetchCollectibles();
  fetchMarketPrices();
});

onBeforeUnmount(() => {
  removeMonitorSubscription?.();
  removeMonitorStartOptionsResolver?.();
});
</script>

<template>
  <TopBar active-page="monitor" />

  <main class="monitor-page">
    <section class="page-head">
      <div>
        <p class="kicker">BidKing TCP</p>
        <h1>{{ t('monitor.title') }}</h1>
        <p>{{ t('monitor.subtitle') }}</p>
      </div>
      <div class="status-strip" data-testid="monitor-state">
        <span class="status-dot" :class="{ live: status.running }"></span>
        <span>{{ statusText }}</span>
        <span>{{ t('monitor.totalEvents', { count: status.totalEvents || events.length }) }}</span>
      </div>
    </section>

    <section class="monitor-grid">
      <form class="control-panel" @submit.prevent="startMonitor">
        <h2>{{ t('monitor.controls') }}</h2>
        <section class="driver-panel" :aria-label="t('monitor.driver.title')">
          <div>
            <h3>{{ t('monitor.driver.title') }}</h3>
            <p data-testid="capture-driver-status">{{ driverStatusText }}</p>
            <p v-if="driverStatus.message" class="driver-status-message" data-testid="capture-driver-message">
              {{ driverStatus.message }}
            </p>
          </div>
          <div class="driver-actions">
            <button class="ghost-button" type="button" :disabled="driverActionPending === 'status'" @click="fetchDriverStatus">
              {{ t('monitor.driver.refresh') }}
            </button>
            <button id="capture-driver-install" class="ghost-button" type="button" :disabled="Boolean(driverActionPending)" @click="installDriver">
              {{ t('monitor.driver.install') }}
            </button>
            <button id="capture-driver-uninstall" class="ghost-button" type="button" :disabled="Boolean(driverActionPending)" @click="uninstallDriver">
              {{ t('monitor.driver.uninstall') }}
            </button>
          </div>
          <p v-if="driverActionMessage" class="helper-text">{{ driverActionMessage }}</p>
        </section>
        <label>
          <span>{{ t('monitor.fields.gameRoot') }}</span>
          <input id="monitor-game-root" v-model="form.gameRoot" type="text" :placeholder="t('monitor.placeholders.gameRoot')">
        </label>
        <div class="form-row">
          <label>
            <span>{{ t('monitor.fields.remoteAddress') }}</span>
            <input v-model="form.remoteAddress" type="text">
          </label>
          <label>
            <span>{{ t('monitor.fields.port') }}</span>
            <input v-model.number="form.port" type="number" min="1" max="65535">
          </label>
          <label>
            <span>{{ t('monitor.fields.batchSeconds') }}</span>
            <input v-model.number="form.batchSeconds" type="number" min="2" max="60">
          </label>
        </div>
        <label>
          <span>{{ t('monitor.fields.outputDir') }}</span>
          <input v-model="form.outputDir" type="text" :placeholder="t('monitor.placeholders.outputDir')">
        </label>
        <div class="actions">
          <button id="monitor-start" class="primary-button" type="submit" :disabled="status.running">
            {{ t('monitor.start') }}
          </button>
          <button class="ghost-button" type="button" :disabled="!status.running" @click="stopMonitor">
            {{ t('monitor.stop') }}
          </button>
        </div>
        <p v-if="actionError || monitor.errorText.value || status.lastError" class="error-text">
          {{ actionError || monitor.errorText.value || status.lastError?.message || status.lastError }}
        </p>
      </form>

      <section class="results-panel">
        <div class="results-toolbar">
          <h2>{{ t('monitor.eventsTitle') }}</h2>
          <input v-model="filterText" type="search" :placeholder="t('monitor.filterPlaceholder')">
          <label class="check-pill"><input v-model="fullOnly" type="checkbox">{{ t('monitor.filters.full') }}</label>
          <label class="check-pill"><input v-model="qualityOnly" type="checkbox">{{ t('monitor.filters.quality') }}</label>
          <label class="check-pill"><input v-model="aggregateOnly" type="checkbox">{{ t('monitor.filters.aggregate') }}</label>
          <button id="monitor-clear-events" class="ghost-button" type="button" :disabled="!events.length" @click="clearEvents">
            {{ t('monitor.clearEvents') }}
          </button>
        </div>

        <div class="table-wrap">
          <table id="monitor-events">
            <thead>
              <tr>
                <th>{{ t('monitor.columns.msg') }}</th>
                <th>{{ t('monitor.columns.source') }}</th>
                <th>{{ t('monitor.columns.round') }}</th>
                <th>{{ t('monitor.columns.skill') }}</th>
                <th>{{ t('monitor.columns.item') }}</th>
                <th>{{ t('monitor.columns.quality') }}</th>
                <th>{{ t('monitor.columns.hit') }}</th>
                <th>{{ t('monitor.columns.price') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredEvents.length">
                <td colspan="8" class="empty-cell">{{ t('monitor.empty') }}</td>
              </tr>
              <tr
                v-for="event in filteredEvents"
                :key="getEventUiKey(event)"
                :class="{ selected: getEventUiKey(selectedEvent) === getEventUiKey(event) }"
                @click="selectEvent(event)"
              >
                <td>{{ getRawEvent(event).msgId || '-' }}</td>
                <td>{{ getRawEvent(event).sourceKind || '-' }}</td>
                <td>{{ getRawEvent(event).round ?? '-' }} / {{ getRawEvent(event).group ?? '-' }}</td>
                <td>{{ getRawEvent(event).skill?.skillCid || '-' }}</td>
                <td>{{ getPrimaryItemName(event) }}</td>
                <td>{{ getQuality(event) }}</td>
                <td>{{ getHitSummary(event) }}</td>
                <td>{{ getPriceSummary(event) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>

    <section id="monitor-detail" class="detail-panel" :aria-label="t('monitor.detailTitle')">
      <header>
        <h2>{{ t('monitor.detailTitle') }}</h2>
        <span v-if="selectedEvent">{{ selectedEvent.key }}</span>
      </header>
      <div v-if="selectedEvent && (getDetailRows(selectedEvent).length || getMetricRows(selectedEvent).length)" class="detail-list">
        <div v-for="row in getMetricRows(selectedEvent)" :key="row.key" class="detail-row metric-row">
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div v-for="row in getDetailRows(selectedEvent)" :key="row.id" class="detail-row">
          <span>box {{ row.box }}</span>
          <strong>{{ row.item }}</strong>
          <span>{{ row.quality }}</span>
          <span>{{ row.size }}</span>
          <span>{{ row.price }}</span>
        </div>
      </div>
      <p v-else class="empty-detail">{{ selectedEvent ? t('monitor.noDetail') : t('monitor.noSelection') }}</p>
      <section v-if="getEventFacts(selectedEvent).length" class="event-section">
        <h3>{{ t('monitor.factsTitle') }}</h3>
        <pre>{{ JSON.stringify(getEventFacts(selectedEvent), null, 2) }}</pre>
      </section>
      <section v-if="getEventState(selectedEvent)" class="event-section">
        <h3>{{ t('monitor.stateTitle') }}</h3>
        <pre>{{ JSON.stringify(getEventState(selectedEvent), null, 2) }}</pre>
      </section>
    </section>

    <section class="market-panel">
      <header>
        <h2>{{ t('monitor.market.title') }}</h2>
        <button class="ghost-button" type="button" @click="fetchMarketPrices">{{ t('monitor.market.refresh') }}</button>
      </header>
      <div class="table-wrap">
        <table id="market-price-table">
          <caption>{{ t('monitor.market.title') }}</caption>
          <thead>
            <tr>
              <th>{{ t('monitor.market.item') }}</th>
              <th>{{ t('monitor.market.minPrice') }}</th>
              <th>{{ t('monitor.market.maxPrice') }}</th>
              <th>{{ t('monitor.market.totalCount') }}</th>
              <th>{{ t('monitor.market.tierCount') }}</th>
              <th>{{ t('monitor.market.updatedAt') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!marketPrices.length">
              <td colspan="6" class="empty-cell">{{ t('monitor.market.empty') }}</td>
            </tr>
            <tr
              v-for="item in marketPrices"
              :key="item.itemCid"
              :class="{ selected: selectedMarketPrice?.itemCid === item.itemCid }"
              @click="selectMarketPrice(item)"
            >
              <td>{{ getMarketItemName(item) }}</td>
              <td>{{ formatNumber(item.minPrice) }}</td>
              <td>{{ formatNumber(item.maxPrice) }}</td>
              <td>{{ formatNumber(item.totalCount) }}</td>
              <td>{{ formatNumber(item.tierCount) }}</td>
              <td>{{ formatDateTime(item.observedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="selectedMarketPrice" id="market-price-detail" class="market-detail">
        <header>
          <h3>{{ getMarketItemName(selectedMarketPrice) }}</h3>
          <span>{{ t('monitor.market.salePrice') }}</span>
        </header>
        <div class="market-detail-grid">
          <div>
            <h4>{{ t('monitor.market.tiers') }}</h4>
            <div v-if="!latestMarketTiers.length" class="market-row empty-market-row">
              <span>{{ t('monitor.market.noTiers') }}</span>
            </div>
            <div v-for="tier in latestMarketTiers" :key="`${tier.price}:${tier.count}`" class="market-row">
              <span>{{ formatNumber(tier.price) }}</span>
              <strong>{{ formatNumber(tier.count) }}</strong>
            </div>
          </div>
          <div>
            <h4>{{ t('monitor.market.history') }}</h4>
            <div v-if="!marketHistory.length" class="market-row empty-market-row">
              <span>{{ t('monitor.market.noHistory') }}</span>
            </div>
            <div v-for="snapshot in marketHistory" :key="snapshot.observedAt" class="market-row">
              <span>{{ formatDateTime(snapshot.observedAt) }}</span>
              <strong>{{ formatNumber(snapshot.minPrice) }} - {{ formatNumber(snapshot.maxPrice) }}</strong>
              <span>{{ formatNumber(snapshot.totalCount) }}</span>
            </div>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>
