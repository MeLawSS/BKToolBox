# Market Price Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist passively captured BidKing trading-page sale prices per collectible and display latest/history data in the Monitor page.

**Architecture:** Add a focused file-backed market price store under `lib/` that normalizes `market_price` events, appends durable snapshots, and maintains a latest index. Wire `BidKingLiveMonitor` to call that store for `market_price` events without creating gameplay facts, expose read-only Express APIs, then add a Monitor UI section for sale price latest rows and selected item history.

**Tech Stack:** Node.js CommonJS modules, Express API in `server.js`, Vue 3 Monitor page, Vitest unit/component tests.

---

### Task 1: Market Price Store

**Files:**
- Create: `lib/bidking-market-price-store.js`
- Create: `lib/bidking-market-price-store.test.mjs`

- [ ] **Step 1: Write failing store tests**

Add this test file:

```js
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  MarketPriceStore,
  normalizeMarketPriceEvent,
} = require('./bidking-market-price-store.js');

describe('MarketPriceStore', () => {
  it('normalizes market price events into sale price snapshots', () => {
    const snapshot = normalizeMarketPriceEvent({
      type: 'market_price',
      key: 'market:1022001:99',
      clientMsgId: 99,
      itemCid: 1022001,
      itemName: '急救毯',
      requestUid: '1247189784563310',
      prices: [
        { price: 1155, count: 105 },
        { price: 1194, count: 9 },
      ],
      minPrice: 1155,
      maxPrice: 1194,
      totalCount: 114,
    }, { now: () => new Date('2026-05-28T12:24:37.000Z') });

    expect(snapshot).toEqual({
      observedAt: '2026-05-28T12:24:37.000Z',
      itemCid: 1022001,
      itemName: '急救毯',
      requestUid: '1247189784563310',
      clientMsgId: 99,
      minPrice: 1155,
      maxPrice: 1194,
      totalCount: 114,
      tierCount: 2,
      tiers: [
        { price: 1155, count: 105 },
        { price: 1194, count: 9 },
      ],
      source: 'tcp-passive',
    });
  });

  it('rejects non-market events and market events without item or tiers', () => {
    expect(normalizeMarketPriceEvent({ type: 'skill' })).toBeNull();
    expect(normalizeMarketPriceEvent({ type: 'market_price', itemCid: null, prices: [{ price: 1, count: 1 }] })).toBeNull();
    expect(normalizeMarketPriceEvent({ type: 'market_price', itemCid: 1022001, prices: [] })).toBeNull();
  });

  it('appends snapshots, writes latest index, and deduplicates exact duplicates', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'market-price-store-'));
    try {
      const store = new MarketPriceStore({
        outputDir,
        now: () => new Date('2026-05-28T12:24:37.000Z'),
      });
      const event = {
        type: 'market_price',
        clientMsgId: 99,
        itemCid: 1022001,
        itemName: '急救毯',
        requestUid: '1247189784563310',
        prices: [
          { price: 1155, count: 105 },
          { price: 1194, count: 9 },
        ],
      };

      expect(store.recordEvent(event)).toMatchObject({ written: true, snapshot: { itemCid: 1022001 } });
      expect(store.recordEvent(event)).toMatchObject({ written: false, reason: 'duplicate' });

      const snapshotsText = await readFile(path.join(outputDir, 'market-prices', 'snapshots.ndjson'), 'utf8');
      expect(snapshotsText.trim().split('\n')).toHaveLength(1);

      expect(store.readLatest()).toMatchObject({
        1022001: {
          itemCid: 1022001,
          itemName: '急救毯',
          minPrice: 1155,
          maxPrice: 1194,
          totalCount: 114,
          tierCount: 2,
        },
      });
      expect(store.readHistory(1022001, { limit: 10 })).toHaveLength(1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run lib/bidking-market-price-store.test.mjs`

Expected: FAIL because `lib/bidking-market-price-store.js` does not exist.

- [ ] **Step 3: Implement the store**

Create `lib/bidking-market-price-store.js`:

```js
const fs = require('fs');
const path = require('path');

const MARKET_DIR_NAME = 'market-prices';
const SNAPSHOTS_FILE = 'snapshots.ndjson';
const LATEST_FILE = 'latest.json';

class MarketPriceStore {
  constructor({ outputDir, now = () => new Date() } = {}) {
    this.outputDir = outputDir || path.join(process.cwd(), 'log');
    this.now = now;
    this.marketDir = path.join(this.outputDir, MARKET_DIR_NAME);
    this.snapshotsPath = path.join(this.marketDir, SNAPSHOTS_FILE);
    this.latestPath = path.join(this.marketDir, LATEST_FILE);
    this.seenSnapshotKeys = new Set();
  }

  recordEvent(event) {
    const snapshot = normalizeMarketPriceEvent(event, { now: this.now });
    if (!snapshot) return { written: false, reason: 'invalid', snapshot: null };
    const key = buildSnapshotDedupKey(snapshot);
    if (this.seenSnapshotKeys.has(key)) return { written: false, reason: 'duplicate', snapshot };

    fs.mkdirSync(this.marketDir, { recursive: true });
    fs.appendFileSync(this.snapshotsPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    this.seenSnapshotKeys.add(key);

    const latest = this.readLatest();
    latest[String(snapshot.itemCid)] = toLatestSnapshot(snapshot);
    fs.writeFileSync(this.latestPath, `${JSON.stringify(latest, null, 2)}\n`, 'utf8');
    return { written: true, snapshot };
  }

  readLatest() {
    try {
      if (!fs.existsSync(this.latestPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.latestPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  readHistory(itemCid, { limit = 100 } = {}) {
    const normalizedCid = Number(itemCid);
    if (!Number.isSafeInteger(normalizedCid) || !fs.existsSync(this.snapshotsPath)) return [];
    const rows = fs.readFileSync(this.snapshotsPath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((snapshot) => snapshot?.itemCid === normalizedCid);
    return rows.slice(Math.max(0, rows.length - Number(limit || 100)));
  }
}

function normalizeMarketPriceEvent(event, { now = () => new Date() } = {}) {
  if (event?.type !== 'market_price') return null;
  const itemCid = Number(event.itemCid);
  if (!Number.isSafeInteger(itemCid)) return null;
  const tiers = normalizeTiers(event.prices);
  if (!tiers.length) return null;
  const minPrice = Number.isFinite(Number(event.minPrice))
    ? Number(event.minPrice)
    : Math.min(...tiers.map((tier) => tier.price));
  const maxPrice = Number.isFinite(Number(event.maxPrice))
    ? Number(event.maxPrice)
    : Math.max(...tiers.map((tier) => tier.price));
  const totalCount = Number.isFinite(Number(event.totalCount))
    ? Number(event.totalCount)
    : tiers.reduce((sum, tier) => sum + tier.count, 0);
  return {
    observedAt: now().toISOString(),
    itemCid,
    itemName: event.itemName ? String(event.itemName) : null,
    requestUid: event.requestUid ? String(event.requestUid) : null,
    clientMsgId: Number.isFinite(Number(event.clientMsgId)) ? Number(event.clientMsgId) : null,
    minPrice,
    maxPrice,
    totalCount,
    tierCount: tiers.length,
    tiers,
    source: 'tcp-passive',
  };
}

function normalizeTiers(prices) {
  return (Array.isArray(prices) ? prices : [])
    .map((entry) => ({
      price: Number(entry?.price),
      count: Number(entry?.count),
    }))
    .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.count));
}

function toLatestSnapshot(snapshot) {
  const { tiers: _tiers, requestUid: _requestUid, clientMsgId: _clientMsgId, ...summary } = snapshot;
  return summary;
}

function buildSnapshotDedupKey(snapshot) {
  const second = String(snapshot.observedAt).replace(/\.\d{3}Z$/u, 'Z');
  const tierSignature = snapshot.tiers.map((tier) => `${tier.price}:${tier.count}`).join('|');
  return [
    snapshot.itemCid,
    second,
    snapshot.minPrice,
    snapshot.maxPrice,
    snapshot.totalCount,
    tierSignature,
  ].join(':');
}

module.exports = {
  MarketPriceStore,
  normalizeMarketPriceEvent,
  buildSnapshotDedupKey,
};
```

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run lib/bidking-market-price-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/bidking-market-price-store.js lib/bidking-market-price-store.test.mjs
git commit -m "feat: add market price store"
```

### Task 2: Live Monitor Persistence and API

**Files:**
- Modify: `lib/bidking-live-monitor.js`
- Modify: `lib/bidking-live-monitor.test.mjs`
- Modify: `server.js`
- Modify: `server.test.mjs`

- [ ] **Step 1: Write failing live monitor test**

Append to `lib/bidking-live-monitor.test.mjs`:

```js
it('persists parsed market price events without adding gameplay facts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
  const recorded = [];
  const monitor = new BidKingLiveMonitor({
    execFileAsync: async () => ({ stdout: '', stderr: '' }),
    sleep: async () => {},
    runtimeRoot: outputDir,
    outputDir,
    marketPriceStore: {
      recordEvent(event) {
        recorded.push(event);
        return { written: true, snapshot: { itemCid: event.itemCid } };
      },
    },
  });
  try {
    const count = monitor.handleParsedEvent({
      type: 'market_price',
      key: 'market:1022001:99',
      clientMsgId: 99,
      itemCid: 1022001,
      requestUid: '1247189784563310',
      prices: [{ price: 1155, count: 105 }],
      minPrice: 1155,
      maxPrice: 1155,
      totalCount: 105,
    });

    expect(count).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(monitor.getRecentEvents()[0]).toMatchObject({
      type: 'market_price',
      facts: [],
      state: expect.objectContaining({ outlines: [] }),
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing server API tests**

Add to `server.test.mjs` a fake market store and route test:

```js
class FakeMarketPriceStore {
  constructor() {
    this.latest = {
      1022001: {
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
        totalCount: 355,
        tierCount: 8,
        source: 'tcp-passive',
      },
    };
    this.history = [
      {
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
        totalCount: 355,
        tierCount: 8,
        tiers: [{ price: 1155, count: 105 }],
        source: 'tcp-passive',
      },
    ];
  }
  readLatest = vi.fn(() => this.latest);
  readHistory = vi.fn(() => this.history);
}
```

Then add:

```js
it('serves latest market prices and item history', async () => {
  const marketPriceStore = new FakeMarketPriceStore();
  const app = createApp({
    spawn: vi.fn(),
    monitor: new FakeMonitor(),
    captureDriver: new FakeCaptureDriver(),
    marketPriceStore,
    logServerEvent: () => {},
  });

  await request(app)
    .get('/api/market-prices/latest')
    .expect(200)
    .expect(({ body }) => {
      expect(body.items).toEqual([marketPriceStore.latest['1022001']]);
    });

  await request(app)
    .get('/api/market-prices/history')
    .query({ itemCid: '1022001', limit: '10' })
    .expect(200)
    .expect(({ body }) => {
      expect(body.itemCid).toBe(1022001);
      expect(body.history).toEqual(marketPriceStore.history);
    });
  expect(marketPriceStore.readHistory).toHaveBeenCalledWith(1022001, { limit: 10 });
});
```

- [ ] **Step 3: Run RED**

Run: `npx vitest run lib/bidking-live-monitor.test.mjs server.test.mjs -t "market price|market prices"`

Expected: FAIL because constructor injection and API routes do not exist.

- [ ] **Step 4: Implement live monitor integration**

In `lib/bidking-live-monitor.js`:

```js
const { MarketPriceStore } = require('./bidking-market-price-store.js');
```

In the constructor:

```js
this.marketPriceStore = deps.marketPriceStore || new MarketPriceStore({
  outputDir: this.outputDir,
  now: this.now,
});
```

In `emitParsedEvent()` after `rawEventSnapshot` is created and before `pushRecentEvent()`:

```js
let marketPriceSnapshot = null;
if (rawEventSnapshot.type === 'market_price') {
  const result = this.marketPriceStore.recordEvent(rawEventSnapshot);
  marketPriceSnapshot = result.snapshot ?? null;
}
```

Add `marketPriceSnapshot` to `enrichedEvent`:

```js
marketPriceSnapshot,
```

- [ ] **Step 5: Implement server routes**

In `server.js`:

```js
const { MarketPriceStore } = require('./lib/bidking-market-price-store');
```

Inside `createApp()`:

```js
const marketPriceStore = deps.marketPriceStore || monitor.marketPriceStore || new MarketPriceStore();
```

Add routes before static middleware:

```js
app.get('/api/market-prices/latest', (_req, res) => {
  const latest = marketPriceStore.readLatest();
  res.json({
    items: Object.values(latest).sort((left, right) => Number(left.itemCid) - Number(right.itemCid)),
  });
});

app.get('/api/market-prices/history', (req, res) => {
  const itemCid = Number(req.query.itemCid);
  if (!Number.isSafeInteger(itemCid)) {
    res.status(400).json({ error: 'itemCid is required' });
    return;
  }
  const limit = parsePositiveInteger(String(req.query.limit ?? '100')) ?? 100;
  res.json({
    itemCid,
    history: marketPriceStore.readHistory(itemCid, { limit }),
  });
});
```

- [ ] **Step 6: Run GREEN**

Run: `npx vitest run lib/bidking-live-monitor.test.mjs server.test.mjs -t "market price|market prices"`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/bidking-live-monitor.js lib/bidking-live-monitor.test.mjs server.js server.test.mjs
git commit -m "feat: persist market price events"
```

### Task 3: Monitor UI Latest and History

**Files:**
- Modify: `src/monitor/App.vue`
- Modify: `src/monitor/App.test.js`
- Modify: `src/monitor/monitor.css`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: Write failing UI test**

In `src/monitor/App.test.js`, extend `mockFetch()`:

```js
if (String(url).endsWith('/api/market-prices/latest')) {
  return {
    ok: true,
    json: async () => ({
      items: [{
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
        totalCount: 355,
        tierCount: 8,
        source: 'tcp-passive',
      }],
    }),
  };
}
if (String(url).includes('/api/market-prices/history')) {
  return {
    ok: true,
    json: async () => ({
      itemCid: 1022001,
      history: [{
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
        totalCount: 355,
        tierCount: 8,
        tiers: [
          { price: 1155, count: 105 },
          { price: 1502, count: 5 },
        ],
        source: 'tcp-passive',
      }],
    }),
  };
}
```

Add test:

```js
it('renders latest market sale prices and selected price tiers', async () => {
  const wrapper = await mountApp();

  expect(fetch).toHaveBeenCalledWith('/api/market-prices/latest');
  expect(wrapper.find('#market-price-table').text()).toContain('交易行售卖价');
  expect(wrapper.find('#market-price-table').text()).toContain('急救毯');
  expect(wrapper.find('#market-price-table').text()).toContain('1,155');
  expect(wrapper.find('#market-price-table').text()).toContain('1,502');
  expect(wrapper.find('#market-price-detail').text()).toContain('售卖价');
  expect(wrapper.find('#market-price-detail').text()).toContain('105');
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/monitor/App.test.js -t "market sale prices"`

Expected: FAIL because the UI does not fetch or render market prices yet.

- [ ] **Step 3: Add Monitor state and fetch functions**

In `src/monitor/App.vue` script:

```js
const marketPrices = ref([]);
const selectedMarketItemCid = ref(null);
const marketHistory = ref([]);
```

Add:

```js
const selectedMarketPrice = computed(() =>
  marketPrices.value.find((item) => item.itemCid === selectedMarketItemCid.value) || marketPrices.value[0] || null
);
```

Add fetch functions:

```js
async function fetchMarketPrices() {
  try {
    const response = await fetch('/api/market-prices/latest');
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    marketPrices.value = Array.isArray(payload.items) ? payload.items : [];
    if (!selectedMarketItemCid.value && marketPrices.value.length) {
      selectedMarketItemCid.value = marketPrices.value[0].itemCid;
      await fetchMarketHistory(selectedMarketItemCid.value);
    }
  } catch (error) {
    actionError.value = getErrorMessage(error);
  }
}

async function fetchMarketHistory(itemCid) {
  if (!itemCid) return;
  try {
    const response = await fetch(`/api/market-prices/history?itemCid=${encodeURIComponent(itemCid)}&limit=50`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    marketHistory.value = Array.isArray(payload.history) ? payload.history : [];
  } catch (error) {
    actionError.value = getErrorMessage(error);
  }
}

async function selectMarketPrice(item) {
  selectedMarketItemCid.value = item.itemCid;
  await fetchMarketHistory(item.itemCid);
}
```

Call `fetchMarketPrices()` from `onMounted()`.

In `pushEvent(event)`, if `getRawEvent(event).type === 'market_price'`, call `fetchMarketPrices()` after adding the event.

- [ ] **Step 4: Add Monitor template section**

Add a section below the controls/results grid:

```vue
<section class="market-panel">
  <header>
    <h2>{{ t('monitor.market.title') }}</h2>
    <button class="ghost-button" type="button" @click="fetchMarketPrices">{{ t('monitor.market.refresh') }}</button>
  </header>
  <div class="table-wrap">
    <table id="market-price-table">
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
          <td>{{ item.itemName || item.itemCid }}</td>
          <td>{{ formatNumber(item.minPrice) }}</td>
          <td>{{ formatNumber(item.maxPrice) }}</td>
          <td>{{ formatNumber(item.totalCount) }}</td>
          <td>{{ formatNumber(item.tierCount) }}</td>
          <td>{{ formatDateTime(item.observedAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <section id="market-price-detail" class="market-detail" v-if="selectedMarketPrice">
    <h3>{{ selectedMarketPrice.itemName || selectedMarketPrice.itemCid }}</h3>
    <div class="market-detail-grid">
      <div>
        <h4>{{ t('monitor.market.tiers') }}</h4>
        <div v-for="tier in (marketHistory.at(-1)?.tiers || [])" :key="`${tier.price}:${tier.count}`" class="market-row">
          <span>{{ formatNumber(tier.price) }}</span>
          <strong>{{ formatNumber(tier.count) }}</strong>
        </div>
      </div>
      <div>
        <h4>{{ t('monitor.market.history') }}</h4>
        <div v-for="snapshot in marketHistory" :key="snapshot.observedAt" class="market-row">
          <span>{{ formatDateTime(snapshot.observedAt) }}</span>
          <strong>{{ formatNumber(snapshot.minPrice) }} - {{ formatNumber(snapshot.maxPrice) }}</strong>
          <span>{{ formatNumber(snapshot.totalCount) }}</span>
        </div>
      </div>
    </div>
  </section>
</section>
```

Add helper:

```js
function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}
```

- [ ] **Step 5: Add i18n labels and styles**

In `src/shared/messages.js`, add Chinese and English keys under `monitor.market`:

```js
market: {
  title: '交易行售卖价',
  refresh: '刷新',
  item: '藏品',
  minPrice: '最近最低价',
  maxPrice: '最高价',
  totalCount: '挂单总数',
  tierCount: '档位数',
  updatedAt: '最近更新时间',
  empty: '暂无交易行售卖价',
  tiers: '价格档位',
  history: '历史快照',
}
```

English:

```js
market: {
  title: 'Market Sale Prices',
  refresh: 'Refresh',
  item: 'Collectible',
  minPrice: 'Latest Low',
  maxPrice: 'High',
  totalCount: 'Listings',
  tierCount: 'Tiers',
  updatedAt: 'Updated',
  empty: 'No market sale prices captured',
  tiers: 'Price Tiers',
  history: 'History',
}
```

In `src/monitor/monitor.css`, add compact panel/table styles matching existing Monitor panels:

```css
.market-panel {
  margin-top: 18px;
}

.market-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.market-detail {
  margin-top: 12px;
}

.market-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.market-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
```

- [ ] **Step 6: Run GREEN**

Run: `npx vitest run src/monitor/App.test.js -t "market sale prices"`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/monitor/App.vue src/monitor/App.test.js src/monitor/monitor.css src/shared/messages.js
git commit -m "feat: show market sale price trends"
```

### Task 4: Full Verification

**Files:**
- No code changes unless verification fails.

- [ ] **Step 1: Run targeted backend tests**

Run: `npx vitest run lib/bidking-market-price-store.test.mjs lib/bidking-live-monitor.test.mjs server.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run targeted frontend tests**

Run: `npx vitest run src/monitor/App.test.js`

Expected: PASS.

- [ ] **Step 3: Verify parser still emits market events**

Run:

```bash
node scripts/parse-bidking-tcp-pcap.mjs tmp/market-capture/price-10000-20260528-122437/price-10000.pcapng --port 10000 --event-json
```

Expected if the capture exists: output contains `"type": "market_price"` events.

- [ ] **Step 4: Check worktree**

Run: `git status --short`

Expected: only known untracked `tmp/` remains, or no unexpected files.
