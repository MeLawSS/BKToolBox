const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

const PRICE_HISTORY_DIR_NAME = 'BKPriceHistory';
const LADDERS_DIR_NAME = 'ladders';

class MarketLadderStore {
  constructor({ rootDir } = {}) {
    this.rootDir = rootDir || path.join(getDocumentsDir(), PRICE_HISTORY_DIR_NAME);
    this.laddersDir = path.join(this.rootDir, LADDERS_DIR_NAME);
    this.seenLadderKeys = new Set();
  }

  recordLadder(snapshot) {
    const record = normalizeLadderRecord(snapshot);
    if (!record) return { written: false, reason: 'invalid', record: null };

    const key = buildLadderDedupKey(record);
    if (this.seenLadderKeys.has(key)) {
      return { written: false, reason: 'duplicate', record };
    }

    fs.mkdirSync(this.laddersDir, { recursive: true });
    fs.appendFileSync(this.getLadderPath(record.itemCid), `${JSON.stringify(record)}\n`, 'utf8');
    this.seenLadderKeys.add(key);

    return { written: true, record };
  }

  readLadders(itemCid, { hours = 24, limit = 2000, now = new Date() } = {}) {
    const normalizedCid = normalizePositiveSafeInteger(itemCid);
    if (normalizedCid === null) return [];

    const ladderPath = this.getLadderPath(normalizedCid);
    if (!fs.existsSync(ladderPath)) return [];

    const cutoff = normalizeCutoffDate(hours, now);
    const normalizedLimit = normalizeLimit(limit, 2000);
    const rows = fs.readFileSync(ladderPath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(parseJsonLine)
      .map(normalizeLadderRecord)
      .filter((record) => record && record.itemCid === normalizedCid)
      .filter((record) => !cutoff || new Date(record.observedAt).getTime() >= cutoff.getTime());

    return rows.slice(Math.max(0, rows.length - normalizedLimit));
  }

  getLadderPath(itemCid) {
    return path.join(this.laddersDir, `${itemCid}.jsonl`);
  }
}

function normalizeLadderRecord(snapshot) {
  const itemCid = normalizePositiveSafeInteger(snapshot?.itemCid);
  if (itemCid === null) return null;

  const date = normalizeObservedDate(snapshot?.observedAt);
  if (!date) return null;

  const tiers = normalizeTiers(snapshot?.tiers);
  if (!tiers.length) return null;

  return {
    observedAt: date.toISOString(),
    itemCid,
    tiers,
  };
}

function normalizeObservedDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers)) return [];

  const normalized = [];
  for (const tier of tiers) {
    const price = normalizePositiveSafeInteger(tier?.price);
    const count = normalizePositiveSafeInteger(tier?.count);
    if (price === null || count === null) return [];
    normalized.push({ price, count });
  }

  return normalized.sort((a, b) => a.price - b.price);
}

function normalizePositiveSafeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeLimit(limit, fallback) {
  const normalized = normalizePositiveSafeInteger(limit);
  return normalized === null ? fallback : normalized;
}

function normalizeCutoffDate(hours, now) {
  const nowDate = normalizeObservedDate(now);
  const normalizedHours = Number(hours);
  const effectiveHours = Number.isFinite(normalizedHours) && normalizedHours >= 0 ? normalizedHours : 24;
  if (!nowDate) return null;
  return new Date(nowDate.getTime() - effectiveHours * 60 * 60 * 1000);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function buildLadderDedupKey(record) {
  const observedSecond = Math.floor(new Date(record.observedAt).getTime() / 1000);
  const tierSignature = record.tiers.map((tier) => `${tier.price}:${tier.count}`).join('|');
  return `${record.itemCid}::${observedSecond}::${tierSignature}`;
}

module.exports = {
  MarketLadderStore,
  normalizeLadderRecord,
};
