const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

const PRICE_HISTORY_DIR_NAME = 'BKPriceHistory';
const ITEMS_DIR_NAME = 'items';
const LATEST_FILE = 'latest.json';
const COLLECTION_CIDS_FILE = 'Cids.json';
const CSV_HEADER = 'observedAt,minPrice\n';

class PriceHistoryStore {
  constructor({ rootDir } = {}) {
    this.rootDir = rootDir || path.join(getDocumentsDir(), PRICE_HISTORY_DIR_NAME);
    this.itemsDir = path.join(this.rootDir, ITEMS_DIR_NAME);
    this.latestPath = path.join(this.rootDir, LATEST_FILE);
    this.collectionCidsPath = path.join(this.rootDir, COLLECTION_CIDS_FILE);
    this.lastKeys = new Set();
    this.hydrateLastKeys();
  }

  recordSnapshot(snapshot) {
    const record = normalizePriceHistoryRecord(snapshot);
    if (!record) return { written: false, reason: 'invalid', record: null };

    const key = buildRecordDedupKey(record);
    if (this.lastKeys.has(key)) {
      return { written: false, reason: 'duplicate', record };
    }

    fs.mkdirSync(this.itemsDir, { recursive: true });
    const itemPath = this.getItemPath(record.itemCid);
    if (!fs.existsSync(itemPath)) {
      fs.writeFileSync(itemPath, CSV_HEADER, 'utf8');
    }
    fs.appendFileSync(itemPath, `${record.observedAt},${record.minPrice}\n`, 'utf8');
    this.lastKeys.add(key);

    const latest = this.readLatest();
    latest[String(record.itemCid)] = record;
    this.writeLatest(latest);

    return { written: true, record };
  }

  readLatest() {
    try {
      if (!fs.existsSync(this.latestPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.latestPath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  readHistory(itemCid, { limit = 1000 } = {}) {
    const normalizedCid = normalizeItemCid(itemCid);
    if (normalizedCid === null) return [];

    const itemPath = this.getItemPath(normalizedCid);
    if (!fs.existsSync(itemPath)) return [];

    const normalizedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : 1000;

    const rows = fs.readFileSync(itemPath, 'utf8')
      .split(/\r?\n/u)
      .slice(1)
      .filter(Boolean)
      .map(parseCsvRow)
      .filter(Boolean);

    return rows.slice(Math.max(0, rows.length - normalizedLimit));
  }

  readCollectionCids() {
    try {
      if (!fs.existsSync(this.collectionCidsPath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.collectionCidsPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];

      const seen = new Set();
      const cids = [];
      for (const value of parsed) {
        const itemCid = normalizeItemCid(value);
        if (itemCid === null || seen.has(itemCid)) continue;
        seen.add(itemCid);
        cids.push(itemCid);
      }
      return cids;
    } catch {
      return [];
    }
  }

  hydrateLastKeys() {
    const latest = this.readLatest();
    for (const record of Object.values(latest)) {
      const normalized = normalizePriceHistoryRecord(record);
      if (normalized) this.lastKeys.add(buildRecordDedupKey(normalized));
    }
  }

  getItemPath(itemCid) {
    return path.join(this.itemsDir, `${itemCid}.csv`);
  }

  writeLatest(latest) {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tempPath = `${this.latestPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(latest, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.latestPath);
  }
}

function normalizePriceHistoryRecord(snapshot) {
  const itemCid = normalizeItemCid(snapshot?.itemCid);
  if (itemCid === null) return null;

  const date = new Date(snapshot.observedAt);
  if (Number.isNaN(date.getTime())) return null;

  const minPrice = Number(snapshot.minPrice);
  if (!Number.isFinite(minPrice)) return null;

  return {
    observedAt: date.toISOString(),
    itemCid,
    minPrice,
  };
}

function normalizeItemCid(value) {
  const itemCid = Number(value);
  return Number.isSafeInteger(itemCid) && itemCid > 0 ? itemCid : null;
}

function buildRecordDedupKey(record) {
  const observedSecond = Math.floor(new Date(record.observedAt).getTime() / 1000);
  return `${record.itemCid}::${observedSecond}::${record.minPrice}`;
}

function parseCsvRow(line) {
  const [observedAt, minPriceText] = line.split(',');
  const date = new Date(observedAt);
  const minPrice = Number(minPriceText);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(minPrice)) return null;
  return {
    observedAt: date.toISOString(),
    minPrice,
  };
}

module.exports = {
  PriceHistoryStore,
  normalizePriceHistoryRecord,
};
