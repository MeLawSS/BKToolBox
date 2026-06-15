<script setup>
import StockMovePanel from './StockMovePanel.vue';
import InjectAgentPanel from './panels/InjectAgentPanel.vue';
import InjectCabinetRewardPanel from './panels/InjectCabinetRewardPanel.vue';
import InjectCollectionScanPanel from './panels/InjectCollectionScanPanel.vue';
import InjectDelayedPricePanel from './panels/InjectDelayedPricePanel.vue';
import InjectListingPanel from './panels/InjectListingPanel.vue';
import InjectWarehousePanel from './panels/InjectWarehousePanel.vue';
import TopBar from '../shared/TopBar.vue';
import { useI18n } from '../shared/i18n.js';
import { LEAVE_INJECT_EVENT } from '../shared/inject-page-lifecycle.js';
import { computed, onMounted, onUnmounted, ref } from 'vue';

const { t } = useI18n();

const autoOperationCommandLoading = ref('');
const collectibles = ref([]);

const workspaceNavGroups = [
  {
    id: 'basic',
    titleKey: 'inject.navGroups.basic',
    items: [
      { id: 'cabinet', titleKey: 'inject.nav.cabinet' },
      { id: 'agent', titleKey: 'inject.nav.agent' },
    ],
  },
  {
    id: 'trading',
    titleKey: 'inject.navGroups.trading',
    items: [
      { id: 'warehouse', titleKey: 'inject.nav.warehouse' },
      { id: 'stockMove', titleKey: 'inject.nav.stockMove' },
      { id: 'listing', titleKey: 'inject.nav.listing' },
      { id: 'delayedPrice', titleKey: 'inject.nav.delayedPrice' },
      { id: 'collectionScan', titleKey: 'inject.nav.collectionScan' },
    ],
  },
];

const activePanelId = ref('cabinet');
const renderedPanelIdSet = ref(new Set(['cabinet']));
const renderedPanels = computed(() => workspaceNavGroups
  .flatMap((group) => group.items)
  .reduce((accumulator, item) => {
    accumulator[item.id] = renderedPanelIdSet.value.has(item.id);
    return accumulator;
  }, {}));

function activatePanel(panelId) {
  activePanelId.value = panelId;
  if (renderedPanelIdSet.value.has(panelId)) return;
  renderedPanelIdSet.value = new Set([...renderedPanelIdSet.value, panelId]);
}

function setAutoOperationCommandLoading(nextValue) {
  autoOperationCommandLoading.value = nextValue;
}

function resetWorkspaceState() {
  activePanelId.value = 'cabinet';
  renderedPanelIdSet.value = new Set(['cabinet']);
  autoOperationCommandLoading.value = '';
  collectibles.value = [];
}

async function loadCollectibles() {
  try {
    const response = await fetch('/data/collectibles.json');
    if (!response.ok) return;
    const payload = await response.json();
    collectibles.value = Array.isArray(payload)
      ? payload
        .map((item) => ({ ...item, itemCid: Number(item.itemCid ?? item.cid ?? item.id) }))
        .filter((item) => Number.isFinite(item.itemCid) && item.itemCid > 0)
      : [];
  } catch {
    collectibles.value = [];
  }
}

onMounted(() => {
  loadCollectibles();
  window.addEventListener(LEAVE_INJECT_EVENT, resetWorkspaceState);
});

onUnmounted(() => {
  window.removeEventListener(LEAVE_INJECT_EVENT, resetWorkspaceState);
});
</script>

<template>
  <TopBar active-page="inject" />

  <main class="page">
    <section class="page-head">
      <div>
        <h1>{{ t('inject.title') }}</h1>
        <p>{{ t('inject.subtitle') }}</p>
      </div>
    </section>

    <section class="workspace-shell">
      <aside class="workspace-shell__nav" :aria-label="t('inject.navLabel')">
        <section
          v-for="group in workspaceNavGroups"
          :key="group.id"
          class="workspace-shell__nav-group"
          :data-testid="`inject-nav-group-${group.id}`"
        >
          <p class="workspace-shell__nav-group-title">{{ t(group.titleKey) }}</p>
          <div class="workspace-shell__nav-list">
            <button
              v-for="item in group.items"
              :key="item.id"
              class="workspace-shell__nav-button"
              type="button"
              :data-testid="`inject-tab-${item.id}`"
              :aria-pressed="activePanelId === item.id ? 'true' : 'false'"
              @click="activatePanel(item.id)"
            >
              {{ t(item.titleKey) }}
            </button>
          </div>
        </section>
      </aside>

      <section class="workspace-shell__panel-host">
        <section
          v-if="renderedPanels.cabinet"
          v-show="activePanelId === 'cabinet'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-cabinet"
          :aria-label="t('inject.cabinetReward')"
        >
          <InjectCabinetRewardPanel />
        </section>

        <section
          v-if="renderedPanels.agent"
          v-show="activePanelId === 'agent'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-agent"
          :aria-label="t('inject.autoOperationAgent')"
        >
          <InjectAgentPanel
            :command-loading="autoOperationCommandLoading"
            @command-loading-change="setAutoOperationCommandLoading"
          />
        </section>

        <section
          v-if="renderedPanels.warehouse"
          v-show="activePanelId === 'warehouse'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-warehouse"
          :aria-label="t('inject.warehouseItems')"
        >
          <InjectWarehousePanel :collectibles="collectibles" />
        </section>

        <section
          v-if="renderedPanels.stockMove"
          v-show="activePanelId === 'stockMove'"
          class="workspace-shell__panel workspace-shell__panel--bare"
          data-testid="inject-panel-stockMove"
        >
          <StockMovePanel :collectibles="collectibles" />
        </section>

        <section
          v-if="renderedPanels.listing"
          v-show="activePanelId === 'listing'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-listing"
          :aria-label="t('inject.listingAdvisor')"
        >
          <InjectListingPanel
            :collectibles="collectibles"
            :command-loading="autoOperationCommandLoading"
            @command-loading-change="setAutoOperationCommandLoading"
          />
        </section>

        <section
          v-if="renderedPanels.delayedPrice"
          v-show="activePanelId === 'delayedPrice'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-delayedPrice"
          :aria-label="t('inject.delayedPriceQuery')"
        >
          <InjectDelayedPricePanel
            :collectibles="collectibles"
            :command-loading="autoOperationCommandLoading"
            @command-loading-change="setAutoOperationCommandLoading"
          />
        </section>

        <section
          v-if="renderedPanels.collectionScan"
          v-show="activePanelId === 'collectionScan'"
          class="inject-panel workspace-shell__panel"
          data-testid="inject-panel-collectionScan"
          :aria-label="t('inject.collectionScanTitle')"
        >
          <InjectCollectionScanPanel />
        </section>
      </section>
    </section>
  </main>
</template>
