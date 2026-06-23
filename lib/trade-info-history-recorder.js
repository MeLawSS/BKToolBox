const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');
const { PriceHistoryStore } = require('./bidking-price-history-store.js');
const { MarketLadderStore } = require('./bidking-market-ladder-store.js');

const PRICE_HISTORY_DIR_NAME = 'BKPriceHistory';
const defaultStoresByRootDir = new Map();

function getDefaultRootDir() {
  return path.join(getDocumentsDir(), PRICE_HISTORY_DIR_NAME);
}

function normalizePositiveInteger(value) {
  let number;
  try {
    number = Number(value);
  } catch {
    return null;
  }
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  const normalized = [];
  for (const tier of tiers) {
    const price = normalizePositiveInteger(tier?.price);
    const count = normalizePositiveInteger(tier?.count);
    if (price === null || count === null) return null;
    normalized.push({ price, count });
  }

  return normalized.sort((left, right) => left.price - right.price);
}

function normalizeObservedAt(value) {
  const observedAt = value || new Date().toISOString();
  let date;
  try {
    date = new Date(observedAt);
  } catch {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getDefaultStores(rootDir) {
  let stores = defaultStoresByRootDir.get(rootDir);
  if (!stores) {
    stores = {
      priceHistoryStore: new PriceHistoryStore({ rootDir }),
      marketLadderStore: new MarketLadderStore({ rootDir }),
    };
    defaultStoresByRootDir.set(rootDir, stores);
  }
  return stores;
}

function getErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function recordCollectionCids(cids, deps = {}) {
  const rootDir = deps.rootDir || getDefaultRootDir();
  const outputPath = path.join(rootDir, 'Cids.json');
  const seen = new Set();
  const itemCids = [];

  for (const value of Array.isArray(cids) ? cids : []) {
    const cid = normalizePositiveInteger(value);
    if (cid === null || seen.has(cid)) continue;
    seen.add(cid);
    itemCids.push(cid);
  }

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(itemCids)}\n`, 'utf8');

  return { written: true, itemCids, outputPath };
}

function recordTradeInfoSnapshot(snapshot, deps = {}) {
  const itemCid = normalizePositiveInteger(snapshot?.itemCid ?? snapshot?.cid);
  const tiers = normalizeTiers(snapshot?.tiers);
  const observedAt = normalizeObservedAt(deps.observedAt);

  if (itemCid === null || tiers === null || observedAt === null) {
    return { ok: false, error: 'invalid trade info snapshot' };
  }

  const minPrice = tiers[0].price;
  const totalCount = tiers.reduce((sum, tier) => sum + tier.count, 0);
  const record = { observedAt, itemCid, tiers };
  const rootDir = deps.rootDir || getDefaultRootDir();

  try {
    const defaultStores = deps.priceHistoryStore && deps.marketLadderStore
      ? null
      : getDefaultStores(rootDir);
    const priceHistoryStore = deps.priceHistoryStore || defaultStores.priceHistoryStore;
    const marketLadderStore = deps.marketLadderStore || defaultStores.marketLadderStore;
    const priceResult = priceHistoryStore.recordSnapshot({ observedAt, itemCid, minPrice });
    const ladderResult = marketLadderStore.recordLadder(record);

    if (priceResult.reason === 'invalid' || ladderResult.reason === 'invalid') {
      return { ok: false, error: 'invalid trade info snapshot' };
    }

    return {
      ok: true,
      itemCid,
      observedAt,
      minPrice,
      tierCount: tiers.length,
      totalCount,
      priceHistory: priceResult,
      ladder: ladderResult,
    };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

module.exports = {
  recordCollectionCids,
  recordTradeInfoSnapshot,
  normalizeTiers,
};
