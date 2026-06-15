const fs = require('fs');
const path = require('path');

const MARKET_DIR_NAME = 'market-prices';
const SNAPSHOTS_FILE = 'snapshots.ndjson';
const LATEST_FILE = 'latest.json';

class MarketPriceStore {
  constructor({ outputDir, now = () => new Date() } = {}) {
    this.now = now;
    this.seenSnapshotKeys = new Set();
    this.setOutputDir(outputDir || path.join(process.cwd(), 'log'));
  }

  setOutputDir(outputDir) {
    this.outputDir = outputDir || path.join(process.cwd(), 'log');
    this.marketDir = path.join(this.outputDir, MARKET_DIR_NAME);
    this.snapshotsPath = path.join(this.marketDir, SNAPSHOTS_FILE);
    this.latestPath = path.join(this.marketDir, LATEST_FILE);
    this.seenSnapshotKeys = new Set();
    this.hydrateSeenSnapshotKeys();
  }

  recordEvent(event) {
    const snapshot = normalizeMarketPriceEvent(event, { now: this.now });
    if (!snapshot) {
      return { written: false, reason: 'invalid', snapshot: null };
    }

    const key = buildSnapshotDedupKey(snapshot);
    if (this.seenSnapshotKeys.has(key)) {
      return { written: false, reason: 'duplicate', snapshot };
    }

    fs.mkdirSync(this.marketDir, { recursive: true });
    fs.appendFileSync(this.snapshotsPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    this.seenSnapshotKeys.add(key);

    const latest = this.readLatest();
    latest[String(snapshot.itemCid)] = toLatestSnapshot(snapshot);
    this.writeLatest(latest);

    return { written: true, snapshot };
  }

  readLatest() {
    try {
      if (!fs.existsSync(this.latestPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.latestPath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return this.rebuildLatestFromSnapshots();
    }
  }

  readHistory(itemCid, { limit = 100 } = {}) {
    const normalizedCid = Number(itemCid);
    if (!Number.isSafeInteger(normalizedCid) || !fs.existsSync(this.snapshotsPath)) {
      return [];
    }

    const normalizedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : 100;

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

    return rows.slice(Math.max(0, rows.length - normalizedLimit));
  }

  hydrateSeenSnapshotKeys() {
    for (const snapshot of this.readSnapshots()) {
      this.seenSnapshotKeys.add(buildSnapshotDedupKey(snapshot));
    }
  }

  rebuildLatestFromSnapshots() {
    const latest = {};
    for (const snapshot of this.readSnapshots()) {
      latest[String(snapshot.itemCid)] = toLatestSnapshot(snapshot);
    }

    if (Object.keys(latest).length > 0) {
      fs.mkdirSync(this.marketDir, { recursive: true });
      this.writeLatest(latest);
    }

    return latest;
  }

  readSnapshots() {
    if (!fs.existsSync(this.snapshotsPath)) return [];

    return fs.readFileSync(this.snapshotsPath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  writeLatest(latest) {
    const tempPath = `${this.latestPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(latest, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.latestPath);
  }
}

function normalizeMarketPriceEvent(event, { now = () => new Date() } = {}) {
  if (event?.type !== 'market_price') return null;

  if (event.itemCid === null || event.itemCid === undefined || event.itemCid === '') {
    return null;
  }
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
    clientMsgId: Number.isFinite(Number(event.clientMsgId))
      ? Number(event.clientMsgId)
      : null,
    minPrice,
    maxPrice,
    totalCount,
    tierCount: tiers.length,
    tiers,
    source: 'tcp-passive',
  };
}

function normalizeTiers(prices) {
  if (!Array.isArray(prices)) return [];

  return prices
    .map((tier) => {
      const price = Number(tier?.price);
      const count = Number(tier?.count);
      if (!Number.isFinite(price) || !Number.isFinite(count)) return null;
      return { price, count };
    })
    .filter(Boolean);
}

function buildSnapshotDedupKey(snapshot) {
  const observedSecond = Math.floor(new Date(snapshot.observedAt).getTime() / 1000);
  const tierSignature = Array.isArray(snapshot.tiers)
    ? snapshot.tiers.map((tier) => `${tier.price}:${tier.count}`).join('|')
    : '';

  return [
    snapshot.itemCid,
    observedSecond,
    snapshot.minPrice,
    snapshot.maxPrice,
    snapshot.totalCount,
    tierSignature,
  ].join('::');
}

function toLatestSnapshot(snapshot) {
  return {
    observedAt: snapshot.observedAt,
    itemCid: snapshot.itemCid,
    itemName: snapshot.itemName,
    minPrice: snapshot.minPrice,
    maxPrice: snapshot.maxPrice,
    totalCount: snapshot.totalCount,
    tierCount: snapshot.tierCount,
    source: snapshot.source,
  };
}

module.exports = {
  MarketPriceStore,
  normalizeMarketPriceEvent,
  buildSnapshotDedupKey,
};
