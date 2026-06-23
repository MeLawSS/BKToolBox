# Monitor Remove Market Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the monitor page "交易所售卖价" panel and stop the page from fetching market sale data while keeping normal event streaming and event detail behavior intact.

**Architecture:** This is a monitor-frontend-only deletion. `src/monitor/App.vue` currently owns both the market-panel UI and the market-price request flow, so the implementation removes that state and markup from the page root component, then deletes the now-unused CSS and rewrites the tests to prove the panel is gone without regressing SSE event rendering.

**Tech Stack:** Vue 3 Composition API, Vitest, @vue/test-utils, Vite

---

### Task 1: Replace market-panel expectations with deletion regression tests

**Files:**
- Modify: `src/monitor/App.test.js`

**Interfaces:**
- Removes test dependency on `#market-price-table` and `#market-price-detail`
- Preserves test coverage for `market_price` SSE events through `#monitor-events`

- [ ] **Step 1: Write the failing deletion regression tests**

In `src/monitor/App.test.js`, replace the market-panel-focused assertions with tests shaped like:

```js
  it('does not render the market sale panel or fetch market price data on mount', async () => {
    const wrapper = await mountApp();

    expect(fetch).not.toHaveBeenCalledWith('/api/market-prices/latest');
    expect(wrapper.find('#market-price-table').exists()).toBe(false);
    expect(wrapper.find('#market-price-detail').exists()).toBe(false);
    expect(wrapper.find('#monitor-detail').exists()).toBe(true);
  });

  it('keeps market_price SSE events visible in the event table without market panel refreshes', async () => {
    const wrapper = await mountApp();

    FakeEventSource.instances[0].emit('event', {
      key: 'market:1022001:99',
      rawEvent: {
        type: 'market_price',
        key: 'market:1022001:99',
        itemCid: 1022001,
        itemName: '急救毯',
      },
    });
    await flushPromises();
    await nextTick();

    expect(fetch).not.toHaveBeenCalledWith('/api/market-prices/latest');
    expect(wrapper.find('#monitor-events').text()).toContain('急救毯');
    expect(wrapper.find('#market-price-table').exists()).toBe(false);
  });
```

- [ ] **Step 2: Run the targeted monitor test to verify RED**

Run:

```bash
npm test -- src/monitor/App.test.js
```

Expected: FAIL because `src/monitor/App.vue` still fetches `/api/market-prices/latest` on mount and still renders `#market-price-table`.

- [ ] **Step 3: Commit the failing-test checkpoint only if your workflow requires it**

```bash
git diff -- src/monitor/App.test.js
```

Expected: test-only diff visible; no production code changed yet.

---

### Task 2: Remove market-panel state, fetches, and markup from the monitor page

**Files:**
- Modify: `src/monitor/App.vue`

**Interfaces:**
- Keeps: monitor controls, monitor event stream, `#monitor-detail`
- Removes: market-panel-specific state, fetch helpers, computed values, and template section

- [ ] **Step 1: Delete market-specific refs and computed values**

In `src/monitor/App.vue`, remove the market-only state from the `<script setup>` top section:

```js
const marketPrices = ref([]);
const selectedMarketItemCid = ref(null);
const marketHistory = ref([]);
let marketHistoryRequestId = 0;

const selectedMarketPrice = computed(() =>
  marketPrices.value.find((item) => item.itemCid === selectedMarketItemCid.value) || marketPrices.value[0] || null
);
const latestMarketTiers = computed(() => marketHistory.value.at(-1)?.tiers || []);
```

- [ ] **Step 2: Delete market-specific helper functions**

Remove the full existing market-only helper functions from `src/monitor/App.vue`. The delete target is the group of definitions that currently contains these exact signatures and lines:

```js
async function fetchMarketPrices() {
  const response = await fetch('/api/market-prices/latest');
}

function getMarketItemName(item) {
  return item?.itemName || getCollectibleNameByCid(item?.itemCid) || item?.itemCid || '-';
}

async function fetchMarketHistory(itemCid) {
  const response = await fetch(`/api/market-prices/history?itemCid=${encodeURIComponent(itemCid)}&limit=50`);
}

async function selectMarketPrice(item) {
  selectedMarketItemCid.value = item.itemCid;
  marketHistory.value = [];
  await fetchMarketHistory(item.itemCid);
}
```

Keep `fetchCollectibles()` and `getCollectibleNameByCid()` because the event table still uses collectible name lookup for `market_price` events through `getPrimaryItemName()`.

- [ ] **Step 3: Remove market bootstrap and SSE side effects**

Update `onMounted()` and `pushEvent()` in `src/monitor/App.vue` to remove market-panel refresh behavior:

```js
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
});

function pushEvent(event) {
  const eventUiKey = getEventUiKey(event);
  if (!eventUiKey || events.value.some((existing) => getEventUiKey(existing) === eventUiKey)) {
    return;
  }
  events.value = [event, ...events.value].slice(0, MAX_EVENTS);
  if (!selectedKey.value) {
    selectedKey.value = eventUiKey;
  }
}
```

- [ ] **Step 4: Delete the market-panel template block**

Remove the entire bottom section from `src/monitor/App.vue`:

```html
    <section class="market-panel">
      <header>
        <h2>{{ t('monitor.market.title') }}</h2>
        <button class="ghost-button" type="button" @click="fetchMarketPrices">{{ t('monitor.market.refresh') }}</button>
      </header>
      <div class="table-wrap">
        <table id="market-price-table">
          <caption>{{ t('monitor.market.title') }}</caption>
        </table>
      </div>

      <section v-if="selectedMarketPrice" id="market-price-detail" class="market-detail">
        <header>
          <h3>{{ getMarketItemName(selectedMarketPrice) }}</h3>
          <span>{{ t('monitor.market.salePrice') }}</span>
        </header>
      </section>
    </section>
```

After this edit, the page template should end right after the `#monitor-detail` section.

- [ ] **Step 5: Run the targeted monitor test to verify GREEN**

Run:

```bash
npm test -- src/monitor/App.test.js
```

Expected: PASS for the updated monitor tests.

- [ ] **Step 6: Commit the page-removal implementation**

```bash
git add src/monitor/App.vue src/monitor/App.test.js
git commit -m "refactor(monitor): remove market sale panel from monitor page"
```

---

### Task 3: Remove dead CSS and run final verification

**Files:**
- Modify: `src/monitor/monitor.css`
- Verify: `docs/superpowers/specs/2026-06-23-monitor-remove-market-panel-design.md`

**Interfaces:**
- Removes dead `.market-panel` / `.market-detail` / `.market-row` styling
- Keeps existing control, results, and detail layout styling intact

- [ ] **Step 1: Delete market-panel-only CSS**

In `src/monitor/monitor.css`, remove the unused block beginning at:

```css
.market-panel {
```

and ending after the related responsive override:

```css
  .market-detail-grid {
    grid-template-columns: 1fr;
  }
```

Delete only the selectors that exist solely for the removed UI:

```css
.market-panel
.market-panel > header
.market-panel h2
.market-panel caption
.market-detail
.market-detail > header
.market-detail h3,
.market-detail h4
.market-detail header span
.market-detail-grid
.market-detail-grid > div
.market-detail-grid h4
.market-row
.market-row:last-child
.market-row strong
.empty-market-row
```

- [ ] **Step 2: Re-run monitor tests**

Run:

```bash
npm test -- src/monitor/App.test.js
```

Expected: PASS, 0 failures.

- [ ] **Step 3: Build the monitor page**

Run:

```bash
npm run build:monitor
```

Expected: Vite build succeeds and emits updated `public/monitor` assets.

- [ ] **Step 4: Commit CSS cleanup and plan artifacts**

```bash
git add src/monitor/monitor.css docs/superpowers/plans/2026-06-23-monitor-remove-market-panel.md
git commit -m "test(monitor): remove market panel CSS and finalize monitor page cleanup"
```
