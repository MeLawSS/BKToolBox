# High-Price Exchange Listing Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manual-confirm high-price listing advisor that records full exchange price ladders, analyzes 12-24 hour market movement, recommends safe high-price listings, and logs every listing attempt.

**Architecture:** `BKPayload64` records full `TradeInfoList` ladders to JSONL beside the existing minimum-price CSV output. Node-side stores read the JSONL history and run a pure, testable advisor that enforces base-price net revenue floors before the Inject UI can confirm `ExchangeItem`. Listing execution remains manual and revalidates against fresh advice immediately before submitting.

**Tech Stack:** C++ IL2CPP payload, Node CommonJS stores, Express API, Vue 3 Inject/Price UI, Vitest, Electron preload/service IPC.

---

## File Structure

- Modify `tools/inject/BKPayload64/BKPayload64.cpp`: append full exchange price ladders to `Documents\BKPriceHistory\ladders\<itemCid>.jsonl` while preserving existing CSV and `latest.json`.
- Create `lib/bidking-market-ladder-store.js`: normalize, persist, and read full ladder JSONL records for one item over a time window.
- Create `lib/bidking-market-ladder-store.test.mjs`: unit tests for JSONL persistence, dedupe, invalid row tolerance, and 24-hour reads.
- Create `lib/high-price-listing-advisor.js`: pure advisor functions for ladder metrics, fee/tax guarded net revenue, state selection, and listing log row construction.
- Create `lib/high-price-listing-advisor.test.mjs`: unit tests for `list_now`, `wait`, `do_not_list`, stale high tier rejection, and net floor enforcement.
- Modify `server.js`: add ladder-history and advice endpoints wired to injectable dependencies for tests.
- Modify `server.test.mjs`: verify new API validation and response shapes.
- Modify `electron/services/inject-service.js`: add a listing execution helper that re-fetches advice, runs `ExchangeItem`, refreshes state through the agent result, and appends `Documents\BidKing\exchange-listings.jsonl`.
- Modify `electron/services/inject-service.test.mjs`: cover revalidation aborts and successful listing log writes.
- Modify `electron/preload.js` and `electron/main.js`: expose the new desktop function to the renderer.
- Modify `src/inject/App.vue`, `src/inject/App.test.js`, and existing Inject styles/i18n files: show advisor results for the selected item and require manual confirmation.
- Modify `docs/AUTO_OPERATION_COMMANDS.md`: document that `ExchangeItem` receives `unitPrice`, but high-price advisor confirmation goes through the new guarded desktop helper.

## Task 1: Market Ladder Store

**Files:**
- Create: `lib/bidking-market-ladder-store.js`
- Create: `lib/bidking-market-ladder-store.test.mjs`

- [ ] **Step 1: Write failing tests for ladder JSONL persistence and reads**

Add `lib/bidking-market-ladder-store.test.mjs`:

```js
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  MarketLadderStore,
  normalizeLadderRecord,
} = require('./bidking-market-ladder-store.js');

describe('MarketLadderStore', () => {
  it('persists sorted price tiers as per-item JSONL and dedupes identical second snapshots', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-ladders-'));
    try {
      const store = new MarketLadderStore({ rootDir });
      const snapshot = {
        observedAt: '2026-06-01T02:00:00.123Z',
        itemCid: 1083009,
        tiers: [
          { price: 7800, count: 1 },
          { price: 6200, count: 2 },
        ],
      };

      expect(store.recordLadder(snapshot)).toEqual({
        written: true,
        record: {
          observedAt: '2026-06-01T02:00:00.123Z',
          itemCid: 1083009,
          tiers: [
            { price: 6200, count: 2 },
            { price: 7800, count: 1 },
          ],
        },
      });
      expect(store.recordLadder(snapshot)).toMatchObject({ written: false, reason: 'duplicate' });

      const jsonl = await readFile(path.join(rootDir, 'ladders', '1083009.jsonl'), 'utf8');
      expect(jsonl.trim().split('\n')).toHaveLength(1);
      expect(store.readLadders(1083009, { hours: 24 })).toEqual([
        {
          observedAt: '2026-06-01T02:00:00.123Z',
          itemCid: 1083009,
          tiers: [
            { price: 6200, count: 2 },
            { price: 7800, count: 1 },
          ],
        },
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('ignores malformed JSONL rows and filters the requested time window', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-ladders-'));
    try {
      await mkdir(path.join(rootDir, 'ladders'), { recursive: true });
      await writeFile(
        path.join(rootDir, 'ladders', '1083009.jsonl'),
        [
          JSON.stringify({ observedAt: '2026-05-30T00:00:00.000Z', itemCid: 1083009, tiers: [{ price: 5000, count: 1 }] }),
          '{bad json',
          JSON.stringify({ observedAt: '2026-06-01T01:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6200, count: 2 }] }),
          JSON.stringify({ observedAt: '2026-06-01T02:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6400, count: 1 }] }),
          '',
        ].join('\n'),
        'utf8',
      );

      const store = new MarketLadderStore({ rootDir });
      expect(store.readLadders(1083009, { hours: 24, now: new Date('2026-06-01T03:00:00.000Z') })).toEqual([
        { observedAt: '2026-06-01T01:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6200, count: 2 }] },
        { observedAt: '2026-06-01T02:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6400, count: 1 }] },
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects records without a valid item cid, timestamp, or positive tiers', () => {
    expect(normalizeLadderRecord({ itemCid: 0, observedAt: '2026-06-01T00:00:00.000Z', tiers: [] })).toBeNull();
    expect(normalizeLadderRecord({ itemCid: 1083009, observedAt: 'bad', tiers: [{ price: 1, count: 1 }] })).toBeNull();
    expect(normalizeLadderRecord({ itemCid: 1083009, observedAt: '2026-06-01T00:00:00.000Z', tiers: [{ price: -1, count: 1 }] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `npm test -- lib/bidking-market-ladder-store.test.mjs`

Expected: FAIL with a module resolution error for `./bidking-market-ladder-store.js`.

- [ ] **Step 3: Implement the store**

Add `lib/bidking-market-ladder-store.js`:

```js
const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

const PRICE_HISTORY_DIR_NAME = 'BKPriceHistory';
const LADDERS_DIR_NAME = 'ladders';

class MarketLadderStore {
  constructor({ rootDir } = {}) {
    this.rootDir = rootDir || path.join(getDocumentsDir(), PRICE_HISTORY_DIR_NAME);
    this.laddersDir = path.join(this.rootDir, LADDERS_DIR_NAME);
    this.lastKeys = new Set();
  }

  recordLadder(snapshot) {
    const record = normalizeLadderRecord(snapshot);
    if (!record) return { written: false, reason: 'invalid', record: null };

    const key = buildDedupKey(record);
    if (this.lastKeys.has(key)) return { written: false, reason: 'duplicate', record };

    fs.mkdirSync(this.laddersDir, { recursive: true });
    fs.appendFileSync(this.getLadderPath(record.itemCid), `${JSON.stringify(record)}\n`, 'utf8');
    this.lastKeys.add(key);
    return { written: true, record };
  }

  readLadders(itemCid, { hours = 24, limit = 2000, now = new Date() } = {}) {
    const cid = normalizeItemCid(itemCid);
    if (cid === null) return [];
    const filePath = this.getLadderPath(cid);
    if (!fs.existsSync(filePath)) return [];

    const cutoffMs = new Date(now).getTime() - Math.max(1, Number(hours) || 24) * 60 * 60 * 1000;
    const normalizedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 2000;

    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(parseJsonLine)
      .map(normalizeLadderRecord)
      .filter((record) => record && new Date(record.observedAt).getTime() >= cutoffMs)
      .slice(-normalizedLimit);
  }

  getLadderPath(itemCid) {
    return path.join(this.laddersDir, `${itemCid}.jsonl`);
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeLadderRecord(snapshot) {
  const itemCid = normalizeItemCid(snapshot?.itemCid);
  if (itemCid === null) return null;

  const date = new Date(snapshot.observedAt);
  if (Number.isNaN(date.getTime())) return null;

  const tiers = Array.isArray(snapshot.tiers)
    ? snapshot.tiers.map(normalizeTier).filter(Boolean).sort((left, right) => left.price - right.price)
    : [];
  if (!tiers.length) return null;

  return {
    observedAt: date.toISOString(),
    itemCid,
    tiers,
  };
}

function normalizeTier(value) {
  const price = Number(value?.price);
  const count = Number(value?.count);
  if (!Number.isSafeInteger(price) || price <= 0) return null;
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  return { price, count };
}

function normalizeItemCid(value) {
  const itemCid = Number(value);
  return Number.isSafeInteger(itemCid) && itemCid > 0 ? itemCid : null;
}

function buildDedupKey(record) {
  const observedSecond = Math.floor(new Date(record.observedAt).getTime() / 1000);
  return `${record.itemCid}::${observedSecond}::${record.tiers.map((tier) => `${tier.price}x${tier.count}`).join('|')}`;
}

module.exports = {
  MarketLadderStore,
  normalizeLadderRecord,
};
```

- [ ] **Step 4: Run the store tests**

Run: `npm test -- lib/bidking-market-ladder-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/bidking-market-ladder-store.js lib/bidking-market-ladder-store.test.mjs
git commit -m "feat: add exchange ladder history store"
```

## Task 2: BKPayload64 Full Ladder JSONL Writer

**Files:**
- Modify: `tools/inject/BKPayload64/BKPayload64.cpp`

- [ ] **Step 1: Add C++ helpers for ladder path creation and JSONL escaping**

In `tools/inject/BKPayload64/BKPayload64.cpp`, change `BuildPriceHistoryPaths` to include ladders:

```cpp
static bool BuildPriceHistoryPaths(char* rootPath, size_t rootSize, char* itemsPath, size_t itemsSize, char* laddersPath = NULL, size_t laddersSize = 0) {
    char docPath[MAX_PATH] = {};
    if (SHGetFolderPathA(NULL, CSIDL_PERSONAL, NULL, 0, docPath) != S_OK) return false;
    snprintf(rootPath, rootSize, "%s\\BKPriceHistory", docPath);
    snprintf(itemsPath, itemsSize, "%s\\items", rootPath);
    CreateDirectoryA(rootPath, NULL);
    CreateDirectoryA(itemsPath, NULL);
    if (laddersPath && laddersSize > 0) {
        snprintf(laddersPath, laddersSize, "%s\\ladders", rootPath);
        CreateDirectoryA(laddersPath, NULL);
    }
    return true;
}
```

Existing calls with four arguments continue to compile because `laddersPath` and `laddersSize` have defaults.

- [ ] **Step 2: Add append helper for full ladder records**

Add this helper after `AppendPriceCsvRecord`:

```cpp
static bool AppendLadderJsonlRecord(int32_t cid, const char* observedAt, const int32_t* prices, const int32_t* counts, int32_t tierCount) {
    if (!observedAt || !prices || !counts || tierCount <= 0) return false;

    char rootPath[MAX_PATH] = {};
    char itemsPath[MAX_PATH] = {};
    char laddersPath[MAX_PATH] = {};
    if (!BuildPriceHistoryPaths(rootPath, sizeof(rootPath), itemsPath, sizeof(itemsPath), laddersPath, sizeof(laddersPath))) return false;

    char jsonlPath[MAX_PATH] = {};
    snprintf(jsonlPath, sizeof(jsonlPath), "%s\\%d.jsonl", laddersPath, cid);

    FILE* f = fopen(jsonlPath, "a");
    if (!f) return false;

    fprintf(f, "{\"observedAt\":\"%s\",\"itemCid\":%d,\"tiers\":[", observedAt, cid);
    for (int32_t i = 0; i < tierCount; i++) {
        if (i > 0) fprintf(f, ",");
        fprintf(f, "{\"price\":%d,\"count\":%d}", prices[i], counts[i]);
    }
    fprintf(f, "]}\n");
    fclose(f);
    return true;
}
```

- [ ] **Step 3: Write the ladder from `WriteTradeList`**

Replace the local loop in `WriteTradeList` with fixed-size buffers and append JSONL after iterating:

```cpp
    int32_t prices[512] = {};
    int32_t counts[512] = {};
    int32_t writtenTiers = 0;
    for (int32_t i = 0; i < count; i++) {
        void* args[1] = { &i };
        Il2CppObject* entry = SafeInvoke(getItem, list, args);
        if (!entry) continue;
        int32_t price       = *(int32_t*)((char*)entry + 24);
        int32_t peopleCount = *(int32_t*)((char*)entry + 28);
        if (price <= 0 || peopleCount <= 0) continue;
        if (minPrice == 0 || price < minPrice) minPrice = price;
        if (writtenTiers < 512) {
            prices[writtenTiers] = price;
            counts[writtenTiers] = peopleCount;
            writtenTiers++;
        }
        Log("%d\t%d\t%d", cid, price, peopleCount);
    }
    if (writtenTiers > 0) {
        char observedAt[64] = {};
        FormatUtcIso(observedAt, sizeof(observedAt));
        if (!AppendLadderJsonlRecord(cid, observedAt, prices, counts, writtenTiers)) {
            Log("WARN: failed to append ladder jsonl for cid=%d", cid);
        }
    }
```

Keep the existing `if (minPriceOut) *minPriceOut = minPrice; return count;` tail.

- [ ] **Step 4: Build the payload**

Run: `bash tools/inject/BKPayload64/build.sh`

Expected: compiler exits 0 and refreshes `tools/inject/BKPayload64/BKPayload64.dll`.

- [ ] **Step 5: Commit**

Run:

```bash
git add tools/inject/BKPayload64/BKPayload64.cpp tools/inject/BKPayload64/BKPayload64.dll
git commit -m "feat: write full exchange ladders from payload"
```

## Task 3: Advisor Core

**Files:**
- Create: `lib/high-price-listing-advisor.js`
- Create: `lib/high-price-listing-advisor.test.mjs`

- [ ] **Step 1: Write failing advisor tests**

Add `lib/high-price-listing-advisor.test.mjs`:

```js
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildListingAdvice,
  calculateListingCosts,
} = require('./high-price-listing-advisor.js');

const baseItem = {
  itemCid: 1083009,
  name: '进气歧管',
  quality: '蓝',
  basePrice: 4208,
};

function snapshot(minutesAgo, tiers) {
  return {
    observedAt: new Date(Date.parse('2026-06-01T12:00:00.000Z') - minutesAgo * 60_000).toISOString(),
    itemCid: 1083009,
    tiers,
  };
}

describe('high-price listing advisor', () => {
  it('recommends list_now when low tiers churn, supply thins, a stable gap exists, and net floor passes', () => {
    const advice = buildListingAdvice({
      item: baseItem,
      ladders: [
        snapshot(180, [{ price: 6200, count: 4 }, { price: 6400, count: 3 }, { price: 7800, count: 1 }]),
        snapshot(120, [{ price: 6200, count: 2 }, { price: 6400, count: 2 }, { price: 7800, count: 1 }]),
        snapshot(60, [{ price: 6400, count: 1 }, { price: 7800, count: 1 }]),
        snapshot(0, [{ price: 6400, count: 1 }, { price: 7800, count: 1 }]),
      ],
      count: 1,
      feeConfig: { listingFeeRate: 0.05, tradeTaxRate: 0.04 },
      now: new Date('2026-06-01T12:00:00.000Z'),
    });

    expect(advice.state).toBe('list_now');
    expect(advice.suggestedUnitPrice).toBe(7799);
    expect(advice.netRevenuePerItem).toBeGreaterThanOrEqual(baseItem.basePrice);
    expect(advice.sellThrough24h).toBeGreaterThanOrEqual(0.55);
    expect(advice.reason).toContain('stable 6400->7800 gap');
  });

  it('returns do_not_list when fee and tax make successful sale net below base price', () => {
    const advice = buildListingAdvice({
      item: baseItem,
      ladders: [snapshot(0, [{ price: 4500, count: 1 }, { price: 4700, count: 1 }])],
      count: 1,
      feeConfig: { listingFeeRate: 0.10, tradeTaxRate: 0.10 },
      now: new Date('2026-06-01T12:00:00.000Z'),
    });

    expect(advice.state).toBe('do_not_list');
    expect(advice.blockers).toContain('net_revenue_below_base_price');
  });

  it('returns wait when history is too thin for high-confidence timing', () => {
    const advice = buildListingAdvice({
      item: baseItem,
      ladders: [snapshot(0, [{ price: 6400, count: 1 }, { price: 7800, count: 1 }])],
      count: 1,
      feeConfig: { listingFeeRate: 0.05, tradeTaxRate: 0.04 },
      now: new Date('2026-06-01T12:00:00.000Z'),
    });

    expect(advice.state).toBe('wait');
    expect(advice.confidence).toBe('low');
    expect(advice.reason).toContain('need more ladder observations');
  });

  it('rejects stale high tiers as do_not_list', () => {
    const staleTier = { price: 7800, count: 1 };
    const advice = buildListingAdvice({
      item: baseItem,
      ladders: [
        snapshot(240, [{ price: 6200, count: 2 }, staleTier]),
        snapshot(180, [{ price: 6300, count: 2 }, staleTier]),
        snapshot(120, [{ price: 6400, count: 1 }, staleTier]),
        snapshot(60, [{ price: 6400, count: 1 }, staleTier]),
        snapshot(0, [{ price: 6400, count: 1 }, staleTier]),
      ],
      count: 1,
      feeConfig: { listingFeeRate: 0.05, tradeTaxRate: 0.04 },
      now: new Date('2026-06-01T12:00:00.000Z'),
    });

    expect(advice.state).toBe('do_not_list');
    expect(advice.blockers).toContain('target_anchored_to_stale_high_tier');
  });

  it('calculates listing fee, trade tax, net revenue, and minimum safe price', () => {
    expect(calculateListingCosts({ unitPrice: 7799, count: 1, basePrice: 4208, feeConfig: { listingFeeRate: 0.05, tradeTaxRate: 0.04 } })).toEqual({
      listingFeePerItem: 390,
      tradeTaxPerItem: 312,
      netRevenuePerItem: 7097,
      minimumSafePrice: 4620,
      listingFeeTotal: 390,
      tradeTaxTotal: 312,
      netRevenueTotal: 7097,
    });
  });
});
```

- [ ] **Step 2: Run advisor tests and verify failure**

Run: `npm test -- lib/high-price-listing-advisor.test.mjs`

Expected: FAIL with a module resolution error for `./high-price-listing-advisor.js`.

- [ ] **Step 3: Implement advisor**

Add `lib/high-price-listing-advisor.js` with these exported functions:

```js
function buildListingAdvice({ item, ladders, count = 1, feeConfig, now = new Date() }) {
  const normalizedItem = normalizeItem(item);
  const normalizedCount = normalizeCount(count);
  const normalizedLadders = normalizeLadders(ladders);
  const blockers = [];

  if (!normalizedItem) return invalidAdvice('invalid_item');
  if (!feeConfig || !Number.isFinite(Number(feeConfig.listingFeeRate)) || !Number.isFinite(Number(feeConfig.tradeTaxRate))) {
    return invalidAdvice('missing_fee_or_tax_config', normalizedItem);
  }
  if (!normalizedLadders.length) return invalidAdvice('missing_ladder_history', normalizedItem);

  const metrics = calculateMetrics(normalizedLadders, now);
  const gap = findStableGap(normalizedLadders);
  const suggestedUnitPrice = gap ? gap.upperPrice - 1 : normalizedLadders.at(-1).tiers[0].price;
  const costs = calculateListingCosts({
    unitPrice: suggestedUnitPrice,
    count: normalizedCount,
    basePrice: normalizedItem.basePrice,
    feeConfig,
  });

  if (costs.netRevenuePerItem < normalizedItem.basePrice) blockers.push('net_revenue_below_base_price');
  if (metrics.staleHighTier) blockers.push('target_anchored_to_stale_high_tier');

  const sellThrough24h = scoreSellThrough({ metrics, hasStableGap: Boolean(gap), sampleCount: normalizedLadders.length });
  const expirationRisk = sellThrough24h >= 0.65 ? 'low' : sellThrough24h >= 0.45 ? 'medium' : 'high';

  if (blockers.length) {
    return buildAdvice({ state: 'do_not_list', confidence: 'high', item: normalizedItem, normalizedCount, suggestedUnitPrice, costs, metrics, sellThrough24h, expirationRisk, blockers, reason: blockers.join(', ') });
  }
  if (normalizedLadders.length < 3) {
    return buildAdvice({ state: 'wait', confidence: 'low', item: normalizedItem, normalizedCount, suggestedUnitPrice, costs, metrics, sellThrough24h, expirationRisk, blockers, reason: 'need more ladder observations before risking a 24-hour listing fee' });
  }
  if (sellThrough24h >= 0.55 && gap && metrics.supplyTrend !== 'rising' && metrics.lowTierChurn !== 'slow') {
    return buildAdvice({ state: 'list_now', confidence: sellThrough24h >= 0.65 ? 'high' : 'medium', item: normalizedItem, normalizedCount, suggestedUnitPrice, costs, metrics, sellThrough24h, expirationRisk, blockers, reason: `low tiers churn ${metrics.lowTierChurn}; supply is ${metrics.supplyTrend}; stable ${gap.lowerPrice}->${gap.upperPrice} gap` });
  }
  return buildAdvice({ state: 'wait', confidence: 'medium', item: normalizedItem, normalizedCount, suggestedUnitPrice, costs, metrics, sellThrough24h, expirationRisk, blockers, reason: 'price gap exists but timing is not strong enough' });
}

function calculateListingCosts({ unitPrice, count = 1, basePrice, feeConfig }) {
  const listingFeePerItem = Math.ceil(Number(unitPrice) * Number(feeConfig.listingFeeRate));
  const tradeTaxPerItem = Math.ceil(Number(unitPrice) * Number(feeConfig.tradeTaxRate));
  const netRevenuePerItem = Number(unitPrice) - listingFeePerItem - tradeTaxPerItem;
  const feeAndTaxRate = Number(feeConfig.listingFeeRate) + Number(feeConfig.tradeTaxRate);
  const minimumSafePrice = Math.ceil(Number(basePrice) / Math.max(0.000001, 1 - feeAndTaxRate));
  return {
    listingFeePerItem,
    tradeTaxPerItem,
    netRevenuePerItem,
    minimumSafePrice,
    listingFeeTotal: listingFeePerItem * count,
    tradeTaxTotal: tradeTaxPerItem * count,
    netRevenueTotal: netRevenuePerItem * count,
  };
}

function normalizeItem(item) {
  const itemCid = Number(item?.itemCid ?? item?.cid ?? item?.id);
  const basePrice = Number(item?.basePrice ?? item?.price);
  if (!Number.isSafeInteger(itemCid) || itemCid <= 0 || !Number.isFinite(basePrice) || basePrice <= 0) return null;
  return { itemCid, name: String(item?.name || itemCid), quality: item?.quality || '', basePrice };
}

function normalizeCount(count) {
  const parsed = Number(count);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeLadders(ladders) {
  return Array.isArray(ladders)
    ? ladders.map((record) => ({
      observedAt: new Date(record.observedAt).toISOString(),
      tiers: Array.isArray(record.tiers)
        ? record.tiers
          .map((tier) => ({ price: Number(tier.price), count: Number(tier.count) }))
          .filter((tier) => Number.isSafeInteger(tier.price) && tier.price > 0 && Number.isSafeInteger(tier.count) && tier.count > 0)
          .sort((left, right) => left.price - right.price)
        : [],
    })).filter((record) => !Number.isNaN(new Date(record.observedAt).getTime()) && record.tiers.length)
      .sort((left, right) => new Date(left.observedAt) - new Date(right.observedAt))
    : [];
}

function calculateMetrics(ladders) {
  const latest = ladders.at(-1);
  const first = ladders[0];
  const totalCounts = ladders.map((record) => record.tiers.reduce((sum, tier) => sum + tier.count, 0));
  const latestLowPrice = latest.tiers[0].price;
  const lowTierPresence = ladders.filter((record) => record.tiers[0]?.price <= latestLowPrice).length / ladders.length;
  const highTierKey = latest.tiers.at(-1) ? `${latest.tiers.at(-1).price}:${latest.tiers.at(-1).count}` : '';
  const highTierPresence = ladders.filter((record) => {
    const tier = record.tiers.at(-1);
    return tier && `${tier.price}:${tier.count}` === highTierKey;
  }).length / ladders.length;
  return {
    minPriceMedian: percentile(ladders.map((record) => record.tiers[0].price), 0.5),
    minPriceP80: percentile(ladders.map((record) => record.tiers[0].price), 0.8),
    minPriceP90: percentile(ladders.map((record) => record.tiers[0].price), 0.9),
    supplyTrend: totalCounts.at(-1) < totalCounts[0] ? 'falling' : totalCounts.at(-1) > totalCounts[0] ? 'rising' : 'flat',
    lowTierChurn: lowTierPresence <= 0.5 ? 'fast' : lowTierPresence <= 0.75 ? 'medium' : 'slow',
    staleHighTier: ladders.length >= 4 && highTierPresence >= 0.8,
    latestTotalListed: totalCounts.at(-1),
  };
}

function findStableGap(ladders) {
  const latestTiers = ladders.at(-1).tiers;
  let best = null;
  for (let i = 0; i < latestTiers.length - 1; i++) {
    const lower = latestTiers[i];
    const upper = latestTiers[i + 1];
    const gapSize = upper.price - lower.price;
    if (gapSize < Math.max(100, Math.ceil(lower.price * 0.12))) continue;
    const persistence = ladders.filter((record) => record.tiers.some((tier, index) => {
      const next = record.tiers[index + 1];
      return next && tier.price === lower.price && next.price === upper.price;
    })).length;
    if (persistence >= Math.min(3, ladders.length)) {
      if (!best || gapSize > best.gapSize) best = { lowerPrice: lower.price, upperPrice: upper.price, gapSize };
    }
  }
  return best;
}

function scoreSellThrough({ metrics, hasStableGap, sampleCount }) {
  let score = 0.2;
  if (sampleCount >= 3) score += 0.15;
  if (hasStableGap) score += 0.2;
  if (metrics.lowTierChurn === 'fast') score += 0.2;
  if (metrics.lowTierChurn === 'medium') score += 0.1;
  if (metrics.supplyTrend === 'falling') score += 0.15;
  if (metrics.supplyTrend === 'flat') score += 0.08;
  if (metrics.staleHighTier) score -= 0.3;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function buildAdvice({ state, confidence, item, normalizedCount, suggestedUnitPrice, costs, metrics, sellThrough24h, expirationRisk, blockers, reason }) {
  return {
    item,
    count: normalizedCount,
    state,
    suggestedUnitPrice,
    totalPrice: suggestedUnitPrice * normalizedCount,
    confidence,
    sellThrough24h,
    expirationRisk,
    reason,
    blockers,
    metrics,
    ...costs,
  };
}

function invalidAdvice(blocker, item = null) {
  return {
    item,
    count: 1,
    state: 'do_not_list',
    confidence: 'low',
    suggestedUnitPrice: null,
    totalPrice: null,
    sellThrough24h: 0,
    expirationRisk: 'high',
    reason: blocker,
    blockers: [blocker],
    metrics: {},
  };
}

module.exports = {
  buildListingAdvice,
  calculateListingCosts,
};
```

- [ ] **Step 4: Run advisor tests**

Run: `npm test -- lib/high-price-listing-advisor.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/high-price-listing-advisor.js lib/high-price-listing-advisor.test.mjs
git commit -m "feat: add high price listing advisor"
```

## Task 4: Server API for Ladders and Advice

**Files:**
- Modify: `server.js`
- Modify: `server.test.mjs`

- [ ] **Step 1: Add failing server route tests**

In `server.test.mjs`, import the new fake dependencies through `createApp` and add tests near the existing price-history tests:

```js
class FakeMarketLadderStore {
  constructor() {
    this.ladders = [
      { observedAt: '2026-06-01T01:00:00.000Z', itemCid: 1022001, tiers: [{ price: 1600, count: 2 }] },
    ];
    this.readLadders = vi.fn(() => this.ladders);
  }
}

class FakeListingFeeConfigStore {
  readConfig = vi.fn(() => ({ listingFeeRate: 0.05, tradeTaxRate: 0.04, source: 'test' }));
}

it('serves per-item full ladder history', async () => {
  const marketLadderStore = new FakeMarketLadderStore();
  const app = createApp({ monitor: new FakeMonitor(), captureDriver: new FakeCaptureDriver(), marketLadderStore, logServerEvent: () => {} });

  const response = await request(app).get('/api/price-history/ladders/1022001?hours=12').expect(200);

  expect(marketLadderStore.readLadders).toHaveBeenCalledWith(1022001, expect.objectContaining({ hours: 12 }));
  expect(response.body).toEqual({ itemCid: 1022001, ladders: marketLadderStore.ladders });
});

it('serves listing advice only when fee and tax config is available', async () => {
  const marketLadderStore = new FakeMarketLadderStore();
  marketLadderStore.ladders = [
    { observedAt: '2026-06-01T00:00:00.000Z', itemCid: 1022001, tiers: [{ price: 1600, count: 2 }, { price: 2400, count: 1 }] },
    { observedAt: '2026-06-01T01:00:00.000Z', itemCid: 1022001, tiers: [{ price: 1800, count: 1 }, { price: 2400, count: 1 }] },
    { observedAt: '2026-06-01T02:00:00.000Z', itemCid: 1022001, tiers: [{ price: 1800, count: 1 }, { price: 2400, count: 1 }] },
  ];
  const app = createApp({
    monitor: new FakeMonitor(),
    captureDriver: new FakeCaptureDriver(),
    marketLadderStore,
    listingFeeConfigStore: new FakeListingFeeConfigStore(),
    logServerEvent: () => {},
  });

  const response = await request(app).get('/api/exchange-listing-advice/1022001?count=1&hours=24').expect(200);

  expect(response.body.item.itemCid).toBe(1022001);
  expect(response.body.state).toMatch(/list_now|wait|do_not_list|probe/u);
  expect(response.body).toHaveProperty('netRevenuePerItem');
});

it('returns 409 for listing advice when fee and tax config is missing', async () => {
  const app = createApp({
    monitor: new FakeMonitor(),
    captureDriver: new FakeCaptureDriver(),
    marketLadderStore: new FakeMarketLadderStore(),
    listingFeeConfigStore: { readConfig: vi.fn(() => null) },
    logServerEvent: () => {},
  });

  await request(app).get('/api/exchange-listing-advice/1022001').expect(409, {
    error: 'listing fee and trade tax config is unavailable',
  });
});
```

- [ ] **Step 2: Run the server tests and verify routes are missing**

Run: `npm test -- server.test.mjs`

Expected: FAIL on `/api/price-history/ladders/:itemCid` or `/api/exchange-listing-advice/:itemCid` returning 404.

- [ ] **Step 3: Wire dependencies and endpoints**

In `server.js`, add imports:

```js
const { MarketLadderStore } = require('./lib/bidking-market-ladder-store');
const { buildListingAdvice } = require('./lib/high-price-listing-advisor');
const collectibles = require('./collectibles.json');
```

Inside `createApp`, add:

```js
const marketLadderStore = deps.marketLadderStore || new MarketLadderStore();
const listingFeeConfigStore = deps.listingFeeConfigStore || {
    readConfig() {
        return null;
    }
};
```

Add helpers inside `createApp`:

```js
function parsePositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findCollectible(itemCid) {
    const item = collectibles.find((collectible) => Number(collectible.itemCid ?? collectible.cid ?? collectible.id) === itemCid);
    if (!item) return null;
    return {
        ...item,
        itemCid,
        basePrice: Number(item.price),
    };
}
```

Add routes after the existing price-history item route:

```js
app.get('/api/price-history/ladders/:itemCid', (req, res) => {
    const itemCid = parsePositiveInteger(String(req.params.itemCid ?? ''));
    if (itemCid === null) {
        res.status(400).json({ error: 'itemCid is required' });
        return;
    }

    const hours = parsePositiveNumber(req.query.hours, 24);
    res.json({
        itemCid,
        ladders: marketLadderStore.readLadders(itemCid, { hours })
    });
});

app.get('/api/exchange-listing-advice/:itemCid', (req, res) => {
    const itemCid = parsePositiveInteger(String(req.params.itemCid ?? ''));
    if (itemCid === null) {
        res.status(400).json({ error: 'itemCid is required' });
        return;
    }

    const feeConfig = listingFeeConfigStore.readConfig();
    if (!feeConfig) {
        res.status(409).json({ error: 'listing fee and trade tax config is unavailable' });
        return;
    }

    const item = findCollectible(itemCid);
    if (!item) {
        res.status(404).json({ error: 'item not found' });
        return;
    }

    const count = parsePositiveInteger(String(req.query.count ?? '1')) ?? 1;
    const hours = parsePositiveNumber(req.query.hours, 24);
    const ladders = marketLadderStore.readLadders(itemCid, { hours });
    res.json(buildListingAdvice({ item, ladders, count, feeConfig }));
});
```

- [ ] **Step 4: Run server tests**

Run: `npm test -- server.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.js server.test.mjs
git commit -m "feat: expose exchange listing advice api"
```

## Task 5: Fee and Tax Config Guard

**Files:**
- Create: `lib/listing-fee-config-store.js`
- Create: `lib/listing-fee-config-store.test.mjs`
- Modify: `server.js`

- [ ] **Step 1: Write failing config-store tests**

Add `lib/listing-fee-config-store.test.mjs`:

```js
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ListingFeeConfigStore } = require('./listing-fee-config-store.js');

describe('ListingFeeConfigStore', () => {
  it('reads fee and tax rates written by reverse-engineered config extraction', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-config-'));
    try {
      await mkdir(path.join(rootDir, 'BidKing'), { recursive: true });
      await writeFile(
        path.join(rootDir, 'BidKing', 'listing-fee-config.json'),
        JSON.stringify({ listingFeeRate: 0.05, tradeTaxRate: 0.04, source: 'TradingExchange_Main.shouxufei' }),
        'utf8',
      );

      expect(new ListingFeeConfigStore({ documentsDir: rootDir }).readConfig()).toEqual({
        listingFeeRate: 0.05,
        tradeTaxRate: 0.04,
        source: 'TradingExchange_Main.shouxufei',
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('returns null when the config is absent or invalid', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-config-'));
    try {
      expect(new ListingFeeConfigStore({ documentsDir: rootDir }).readConfig()).toBeNull();
      await mkdir(path.join(rootDir, 'BidKing'), { recursive: true });
      await writeFile(path.join(rootDir, 'BidKing', 'listing-fee-config.json'), JSON.stringify({ listingFeeRate: 'x', tradeTaxRate: 0.04 }), 'utf8');
      expect(new ListingFeeConfigStore({ documentsDir: rootDir }).readConfig()).toBeNull();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run config tests and verify module is missing**

Run: `npm test -- lib/listing-fee-config-store.test.mjs`

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement config store**

Add `lib/listing-fee-config-store.js`:

```js
const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

class ListingFeeConfigStore {
  constructor({ documentsDir } = {}) {
    this.documentsDir = documentsDir || getDocumentsDir();
    this.configPath = path.join(this.documentsDir, 'BidKing', 'listing-fee-config.json');
  }

  readConfig() {
    try {
      if (!fs.existsSync(this.configPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      const listingFeeRate = Number(parsed.listingFeeRate);
      const tradeTaxRate = Number(parsed.tradeTaxRate);
      if (!Number.isFinite(listingFeeRate) || listingFeeRate < 0 || listingFeeRate >= 1) return null;
      if (!Number.isFinite(tradeTaxRate) || tradeTaxRate < 0 || tradeTaxRate >= 1) return null;
      return {
        listingFeeRate,
        tradeTaxRate,
        source: String(parsed.source || 'unknown'),
      };
    } catch {
      return null;
    }
  }
}

module.exports = { ListingFeeConfigStore };
```

- [ ] **Step 4: Use the config store in `server.js`**

Import:

```js
const { ListingFeeConfigStore } = require('./lib/listing-fee-config-store');
```

Replace the temporary default dependency:

```js
const listingFeeConfigStore = deps.listingFeeConfigStore || new ListingFeeConfigStore();
```

- [ ] **Step 5: Run tests**

Run: `npm test -- lib/listing-fee-config-store.test.mjs server.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/listing-fee-config-store.js lib/listing-fee-config-store.test.mjs server.js
git commit -m "feat: guard listing advice with fee config"
```

## Task 6: Guarded Listing Execution and Log

**Files:**
- Modify: `electron/services/inject-service.js`
- Modify: `electron/services/inject-service.test.mjs`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Add failing service tests**

In `electron/services/inject-service.test.mjs`, add:

```js
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

it('aborts guarded listing when refreshed advice is not list_now', async () => {
  await expect(confirmHighPriceExchangeListing({
    itemCid: 1083009,
    count: 1,
    expectedUnitPrice: 7799,
    advice: { state: 'wait' },
  }, {
    fetchListingAdvice: async () => ({ state: 'wait', blockers: [] }),
  })).rejects.toThrow('Listing advice is no longer list_now');
});

it('runs ExchangeItem and writes exchange-listings.jsonl after revalidation', async () => {
  const documentsDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-listing-log-'));
  try {
    const advice = {
      item: { itemCid: 1083009, name: '进气歧管', quality: '蓝', basePrice: 4208 },
      count: 1,
      state: 'list_now',
      suggestedUnitPrice: 7799,
      totalPrice: 7799,
      listingFeePerItem: 390,
      tradeTaxPerItem: 312,
      netRevenuePerItem: 7097,
      minimumSafePrice: 4620,
      sellThrough24h: 0.62,
      expirationRisk: 'medium',
      strategy: 'high_price_stable_gap',
      confidence: 'high',
      reason: 'stable gap',
      marketSnapshot: [{ price: 6400, count: 1 }, { price: 7800, count: 1 }],
    };
    const runAutoOperationCommand = vi.fn(async () => ({ ok: true, value: { ok: true, stocksRefreshed: true, exchangeItemsRefreshed: true } }));

    const result = await confirmHighPriceExchangeListing({
      itemCid: 1083009,
      count: 1,
      expectedUnitPrice: 7799,
    }, {
      documentsDir,
      fetchListingAdvice: async () => advice,
      runAutoOperationCommand,
      now: () => new Date('2026-06-01T18:30:00.000Z'),
    });

    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1083009, count: 1, unitPrice: 7799 }, expect.any(Object));
    expect(result.ok).toBe(true);
    const logText = await readFile(path.join(documentsDir, 'BidKing', 'exchange-listings.jsonl'), 'utf8');
    expect(JSON.parse(logText)).toMatchObject({
      observedAt: '2026-06-01T18:30:00.000Z',
      itemCid: 1083009,
      unitPrice: 7799,
      netRevenuePerItem: 7097,
      result: { ok: true, stocksRefreshed: true, exchangeItemsRefreshed: true },
    });
  } finally {
    await rm(documentsDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run service tests and verify helper is missing**

Run: `npm test -- electron/services/inject-service.test.mjs`

Expected: FAIL because `confirmHighPriceExchangeListing` is not exported.

- [ ] **Step 3: Implement `confirmHighPriceExchangeListing`**

In `electron/services/inject-service.js`, add:

```js
function getExchangeListingsLogPath(documentsDir) {
    return path.join(documentsDir, 'BidKing', 'exchange-listings.jsonl');
}

async function defaultFetchListingAdvice({ itemCid, count, hours = 24 }) {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/exchange-listing-advice/${itemCid}?count=${count}&hours=${hours}`);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

async function appendListingLog(row, documentsDir) {
    const logPath = getExchangeListingsLogPath(documentsDir);
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    await fs.promises.appendFile(logPath, `${JSON.stringify(row)}\n`, 'utf8');
    return logPath;
}

async function confirmHighPriceExchangeListing(request, deps = {}) {
    const itemCid = Number(request?.itemCid);
    const count = Number(request?.count || 1);
    const expectedUnitPrice = Number(request?.expectedUnitPrice);
    if (!Number.isSafeInteger(itemCid) || itemCid <= 0) throw new Error('itemCid is required');
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('count is required');
    if (!Number.isSafeInteger(expectedUnitPrice) || expectedUnitPrice <= 0) throw new Error('expectedUnitPrice is required');

    const advice = await (deps.fetchListingAdvice || defaultFetchListingAdvice)({ itemCid, count, hours: request.hours || 24 });
    if (advice.state !== 'list_now') throw new Error('Listing advice is no longer list_now');
    if (Number(advice.suggestedUnitPrice) !== expectedUnitPrice) throw new Error('Listing advice price changed');
    if (Number(advice.netRevenuePerItem) < Number(advice.item?.basePrice)) throw new Error('Net revenue is below base price');

    const commandResult = await (deps.runAutoOperationCommand || runAutoOperationCommand)('ExchangeItem', {
        itemCid,
        count,
        unitPrice: expectedUnitPrice,
    }, deps);

    const row = {
        observedAt: (deps.now ? deps.now() : new Date()).toISOString(),
        itemCid,
        name: advice.item?.name,
        count,
        unitPrice: expectedUnitPrice,
        totalPrice: expectedUnitPrice * count,
        basePrice: advice.item?.basePrice,
        listingFee: advice.listingFeePerItem,
        tradeTax: advice.tradeTaxPerItem,
        netRevenuePerItem: advice.netRevenuePerItem,
        minimumSafePrice: advice.minimumSafePrice,
        sellThrough24h: advice.sellThrough24h,
        expirationRisk: advice.expirationRisk,
        strategy: advice.strategy || 'high_price_stable_gap',
        confidence: advice.confidence,
        reason: advice.reason,
        marketSnapshot: advice.marketSnapshot || advice.latestLadder || [],
        result: commandResult.value || commandResult,
    };
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (documentsDir) row.logPath = await appendListingLog(row, documentsDir);
    return { ok: true, value: row };
}
```

Export `confirmHighPriceExchangeListing` and `getExchangeListingsLogPath`.

- [ ] **Step 4: Expose Electron IPC**

In `electron/main.js`, import and register:

```js
const { confirmHighPriceExchangeListing } = require('./services/inject-service');

ipcMain.handle('bidking:confirm-high-price-exchange-listing', async (_event, request) =>
    confirmHighPriceExchangeListing(request, { documentsDir: app.getPath('documents') })
);
```

In `electron/preload.js`, expose:

```js
confirmHighPriceExchangeListing: (request) => ipcRenderer.invoke('bidking:confirm-high-price-exchange-listing', request),
```

- [ ] **Step 5: Run service tests**

Run: `npm test -- electron/services/inject-service.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add electron/services/inject-service.js electron/services/inject-service.test.mjs electron/main.js electron/preload.js
git commit -m "feat: add guarded exchange listing execution"
```

## Task 7: Inject UI Advisor Panel

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/shared/i18n.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: Add failing UI tests**

In `src/inject/App.test.js`, add tests that mock:

```js
window.bidkingDesktop = {
  isDesktop: true,
  startAutoOperationAgent: vi.fn(async () => ({ ok: true })),
  runAutoOperationCommand: vi.fn(async () => ({ ok: true, value: { ok: true } })),
  confirmHighPriceExchangeListing: vi.fn(async () => ({ ok: true, value: { itemCid: 1083009, unitPrice: 7799 } })),
};
```

Add fetch mock for advice:

```js
if (String(url).includes('/api/exchange-listing-advice/1083009')) {
  return {
    ok: true,
    json: async () => ({
      item: { itemCid: 1083009, name: '进气歧管', quality: '蓝', basePrice: 4208 },
      count: 1,
      state: 'list_now',
      suggestedUnitPrice: 7799,
      netRevenuePerItem: 7097,
      minimumSafePrice: 4620,
      listingFeePerItem: 390,
      tradeTaxPerItem: 312,
      sellThrough24h: 0.62,
      expirationRisk: 'medium',
      confidence: 'high',
      reason: 'stable 6400->7800 gap',
    }),
  };
}
```

Assert:

```js
expect(wrapper.find('[data-testid="exchange-listing-advice"]').text()).toContain('list_now');
expect(wrapper.find('[data-testid="exchange-listing-advice"]').text()).toContain('7,799');
await wrapper.find('[data-testid="confirm-high-price-listing"]').trigger('click');
expect(window.bidkingDesktop.confirmHighPriceExchangeListing).toHaveBeenCalledWith({
  itemCid: 1083009,
  count: 1,
  expectedUnitPrice: 7799,
  hours: 24,
});
```

- [ ] **Step 2: Run Inject UI tests and verify failure**

Run: `npm test -- src/inject/App.test.js`

Expected: FAIL because the advisor panel is missing.

- [ ] **Step 3: Add state and fetch logic to `src/inject/App.vue`**

Add refs:

```js
const listingAdvice = ref(null);
const listingAdviceLoading = ref(false);
const listingAdviceError = ref('');
```

Add computed:

```js
const canConfirmHighPriceListing = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.confirmHighPriceExchangeListing === 'function' &&
    listingAdvice.value?.state === 'list_now' &&
    listingAdvice.value?.suggestedUnitPrice === exchangeItemUnitPrice.value,
  ),
);
```

Add functions:

```js
async function refreshListingAdvice() {
  if (!exchangeItemCid.value || listingAdviceLoading.value) return;
  listingAdviceLoading.value = true;
  listingAdviceError.value = '';
  try {
    const response = await fetch(`/api/exchange-listing-advice/${exchangeItemCid.value}?count=${exchangeItemCount.value}&hours=24`);
    if (!response.ok) throw new Error(await response.text());
    listingAdvice.value = await response.json();
    if (listingAdvice.value?.suggestedUnitPrice) {
      exchangeItemInputs.value.unitPrice = String(listingAdvice.value.suggestedUnitPrice);
    }
  } catch (error) {
    listingAdviceError.value = error?.message || t('inject.failed');
  } finally {
    listingAdviceLoading.value = false;
  }
}

async function confirmHighPriceListing() {
  if (!canConfirmHighPriceListing.value) return;
  autoOperationCommandLoading.value = 'ConfirmHighPriceListing';
  autoOperationError.value = '';
  try {
    const response = await window.bidkingDesktop.confirmHighPriceExchangeListing({
      itemCid: exchangeItemCid.value,
      count: exchangeItemCount.value,
      expectedUnitPrice: exchangeItemUnitPrice.value,
      hours: 24,
    });
    if (response?.ok === false) throw new Error(response.error || t('inject.failed'));
    autoOperationCommandResult.value = response;
  } catch (error) {
    autoOperationError.value = error?.message || t('inject.failed');
  } finally {
    autoOperationCommandLoading.value = '';
  }
}
```

- [ ] **Step 4: Add advisor template panel**

Place this below the manual `ExchangeItem` controls:

```vue
<section class="auto-operation-card" data-testid="exchange-listing-advice">
  <header>
    <div>
      <h2>{{ t('inject.listingAdvisor') }}</h2>
      <p>{{ t('inject.listingAdvisorSub') }}</p>
    </div>
    <button class="ghost-button" type="button" :disabled="listingAdviceLoading || !exchangeItemCid" @click="refreshListingAdvice">
      {{ listingAdviceLoading ? t('inject.loading') : t('inject.refreshAdvice') }}
    </button>
  </header>

  <p v-if="listingAdviceError" class="error-text">{{ listingAdviceError }}</p>
  <div v-if="listingAdvice" class="advisor-grid">
    <span>{{ t('inject.adviceState') }}</span><strong>{{ listingAdvice.state }}</strong>
    <span>{{ t('inject.suggestedUnitPrice') }}</span><strong>{{ formatNumber(listingAdvice.suggestedUnitPrice) }}</strong>
    <span>{{ t('inject.netRevenuePerItem') }}</span><strong>{{ formatNumber(listingAdvice.netRevenuePerItem) }}</strong>
    <span>{{ t('inject.expirationRisk') }}</span><strong>{{ listingAdvice.expirationRisk }}</strong>
    <span>{{ t('inject.reason') }}</span><strong>{{ listingAdvice.reason }}</strong>
  </div>
  <button
    class="primary-button"
    type="button"
    data-testid="confirm-high-price-listing"
    :disabled="!canConfirmHighPriceListing || autoOperationCommandLoading"
    @click="confirmHighPriceListing"
  >
    {{ t('inject.confirmHighPriceListing') }}
  </button>
</section>
```

Use the existing `formatNumber` helper if present. If it is absent, add:

```js
function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '-';
}
```

- [ ] **Step 5: Add i18n and CSS**

Add keys to `src/shared/i18n.js`:

```js
'inject.listingAdvisor': '高价上架顾问',
'inject.listingAdvisorSub': '根据最近 12-24 小时交易所价格梯度给出手动上架建议。',
'inject.refreshAdvice': '刷新建议',
'inject.adviceState': '建议状态',
'inject.suggestedUnitPrice': '建议单价',
'inject.netRevenuePerItem': '单件净收益',
'inject.expirationRisk': '过期风险',
'inject.reason': '原因',
'inject.confirmHighPriceListing': '确认高价上架',
```

Add compact CSS to `src/inject/inject.css`:

```css
.advisor-grid {
  display: grid;
  grid-template-columns: minmax(8rem, max-content) 1fr;
  gap: 0.5rem 1rem;
  align-items: start;
}

.advisor-grid span {
  color: var(--muted-text);
}

.advisor-grid strong {
  font-weight: 600;
}
```

- [ ] **Step 6: Run UI tests and build Inject**

Run:

```bash
npm test -- src/inject/App.test.js
npm run build:inject
```

Expected: both PASS. `npm run build:inject` updates `public/inject`; review generated assets separately before committing.

- [ ] **Step 7: Commit source and intended build output**

Run:

```bash
git add src/inject/App.vue src/inject/App.test.js src/shared/i18n.js src/inject/inject.css public/inject
git commit -m "feat: show high price listing advisor in inject"
```

## Task 8: Documentation and Verification

**Files:**
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`
- Modify: `docs/superpowers/specs/2026-06-01-high-price-exchange-listing-design.md`

- [ ] **Step 1: Update command docs**

Add this section to `docs/AUTO_OPERATION_COMMANDS.md`:

```md
## High-Price Listing Advisor

The advisor does not introduce a new AutoOperation pipe command. The renderer calls the desktop helper `confirmHighPriceExchangeListing`, which:

1. Fetches fresh `/api/exchange-listing-advice/:itemCid`.
2. Requires `state === "list_now"`.
3. Requires the refreshed suggested price to match the visible price.
4. Calls AutoOperation `ExchangeItem` with:

```json
{
  "itemCid": 1083009,
  "count": 1,
  "unitPrice": 7799
}
```

5. Appends `Documents\BidKing\exchange-listings.jsonl`.

Do not call `ExchangeItem` directly for advisor-driven listing unless intentionally bypassing the net revenue floor and stale-market revalidation.
```

- [ ] **Step 2: Run full targeted verification**

Run:

```bash
npm test -- lib/bidking-market-ladder-store.test.mjs lib/high-price-listing-advisor.test.mjs lib/listing-fee-config-store.test.mjs server.test.mjs electron/services/inject-service.test.mjs src/inject/App.test.js
bash tools/inject/BKPayload64/build.sh
npm run build:inject
```

Expected: all commands exit 0.

- [ ] **Step 3: Check git diff for unrelated generated files**

Run: `git status --short`

Expected: staged/unstaged changes only include files touched by the tasks. Existing unrelated dirty `public/price` assets and `tmp/` remain uncommitted unless the user explicitly asks to include them.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add docs/AUTO_OPERATION_COMMANDS.md docs/superpowers/specs/2026-06-01-high-price-exchange-listing-design.md
git commit -m "docs: document high price listing advisor"
```

## Self-Review Checklist

- Spec coverage:
  - Full ladder storage: Task 1 and Task 2.
  - 12-24 hour observation window: Task 1 read API and Task 4 route query.
  - Heuristic metrics and states: Task 3.
  - Net revenue floor with listing fee and trade tax: Task 3 and Task 5.
  - No hard-coded fee/tax guesses for execution: Task 5 and Task 6.
  - Manual confirmation with re-fetch/re-run/abort/submit/refresh/log: Task 6 and Task 7.
  - Listing log at `Documents\BidKing\exchange-listings.jsonl`: Task 6.
  - 24-hour expiration risk explanation: Task 3 and Task 7.
- Placeholder scan:
  - The plan contains concrete paths, commands, expected results, and code snippets for each implementation step.
- Type consistency:
  - `MarketLadderStore.readLadders(itemCid, { hours, limit, now })` is used by server and tests.
  - `buildListingAdvice({ item, ladders, count, feeConfig, now })` is used by server and tests.
  - `confirmHighPriceExchangeListing({ itemCid, count, expectedUnitPrice, hours })` is exposed by Electron and used by Inject UI.
