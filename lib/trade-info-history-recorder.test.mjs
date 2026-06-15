/* @vitest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PriceHistoryStore } from './bidking-price-history-store.js';
import { MarketLadderStore } from './bidking-market-ladder-store.js';
import {
  recordCollectionCids,
  recordTradeInfoSnapshot,
} from './trade-info-history-recorder.js';

describe('trade-info-history-recorder', () => {
  it('writes Cids.json with unique positive cids', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      const result = recordCollectionCids([1032006, 1032006, 0, 'bad', 1013007], { rootDir });
      expect(result).toEqual({ written: true, itemCids: [1032006, 1013007] });
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'Cids.json'), 'utf8'))).toEqual([1032006, 1013007]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('skips non-convertible collection cids without throwing', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      let result;
      expect(() => {
        result = recordCollectionCids([Symbol('bad'), 1032006], { rootDir });
      }).not.toThrow();

      expect(result).toEqual({ written: true, itemCids: [1032006] });
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'Cids.json'), 'utf8'))).toEqual([1032006]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('records min-price CSV, latest index, and ladder JSONL', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      const priceHistoryStore = new PriceHistoryStore({ rootDir });
      const marketLadderStore = new MarketLadderStore({ rootDir });
      const result = recordTradeInfoSnapshot({
        itemCid: 1032006,
        tiers: [
          { price: 6400, count: 4 },
          { price: 6200, count: 3 },
        ],
      }, {
        observedAt: '2026-06-02T12:30:15.123Z',
        priceHistoryStore,
        marketLadderStore,
      });
      expect(result).toMatchObject({
        ok: true,
        itemCid: 1032006,
        minPrice: 6200,
        tierCount: 2,
        totalCount: 7,
      });
      expect(fs.readFileSync(path.join(rootDir, 'items', '1032006.csv'), 'utf8')).toContain('2026-06-02T12:30:15.123Z,6200');
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'latest.json'), 'utf8'))['1032006'].minPrice).toBe(6200);
      const ladderLine = fs.readFileSync(path.join(rootDir, 'ladders', '1032006.jsonl'), 'utf8').trim();
      expect(JSON.parse(ladderLine)).toEqual({
        observedAt: '2026-06-02T12:30:15.123Z',
        itemCid: 1032006,
        tiers: [
          { price: 6200, count: 3 },
          { price: 6400, count: 4 },
        ],
      });
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects trade info with no valid tiers', () => {
    const result = recordTradeInfoSnapshot({
      itemCid: 1032006,
      tiers: [{ price: 0, count: 1 }],
    }, { observedAt: '2026-06-02T12:30:15.123Z' });
    expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
  });

  it('rejects non-convertible itemCid without throwing', () => {
    let result;
    expect(() => {
      result = recordTradeInfoSnapshot({
        itemCid: Symbol('bad'),
        tiers: [{ price: 1, count: 1 }],
      }, { observedAt: '2026-06-02T12:30:15.123Z' });
    }).not.toThrow();

    expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
  });

  it('rejects non-convertible tier price without throwing', () => {
    let result;
    expect(() => {
      result = recordTradeInfoSnapshot({
        itemCid: 1032006,
        tiers: [{ price: Symbol('bad'), count: 1 }],
      }, { observedAt: '2026-06-02T12:30:15.123Z' });
    }).not.toThrow();

    expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
  });

  it('rejects trade info with an invalid observedAt', () => {
    const result = recordTradeInfoSnapshot({
      itemCid: 1032006,
      tiers: [{ price: 6200, count: 3 }],
    }, { observedAt: 'bad-date' });

    expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
  });

  it('rejects trade info with a non-convertible observedAt without throwing', () => {
    let result;
    expect(() => {
      result = recordTradeInfoSnapshot({
        itemCid: 1032006,
        tiers: [{ price: 6200, count: 3 }],
      }, { observedAt: Symbol('bad') });
    }).not.toThrow();

    expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
  });

  it('rejects mixed valid and invalid tiers without writing files', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      const result = recordTradeInfoSnapshot({
        itemCid: 1032006,
        tiers: [
          { price: 6200, count: 3 },
          { price: 6400, count: 0 },
        ],
      }, {
        observedAt: '2026-06-02T12:30:15.123Z',
        rootDir,
      });

      expect(result).toEqual({ ok: false, error: 'invalid trade info snapshot' });
      expect(fs.existsSync(path.join(rootDir, 'items', '1032006.csv'))).toBe(false);
      expect(fs.existsSync(path.join(rootDir, 'ladders', '1032006.jsonl'))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('dedupes duplicate snapshots when using rootDir default stores', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-trade-recorder-'));
    try {
      const snapshot = {
        itemCid: 1032006,
        tiers: [
          { price: 6200, count: 3 },
          { price: 6400, count: 4 },
        ],
      };
      const deps = { observedAt: '2026-06-02T12:30:15.123Z', rootDir };

      expect(recordTradeInfoSnapshot(snapshot, deps)).toMatchObject({ ok: true });
      expect(recordTradeInfoSnapshot(snapshot, deps)).toMatchObject({ ok: true });

      const ladderRows = fs.readFileSync(path.join(rootDir, 'ladders', '1032006.jsonl'), 'utf8').trim().split('\n');
      expect(ladderRows).toHaveLength(1);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('returns normalized errors when a store throws', () => {
    const result = recordTradeInfoSnapshot({
      itemCid: 1032006,
      tiers: [{ price: 6200, count: 3 }],
    }, {
      observedAt: '2026-06-02T12:30:15.123Z',
      priceHistoryStore: {
        recordSnapshot() {
          throw new Error('disk full');
        },
      },
      marketLadderStore: {
        recordLadder() {
          return { written: true };
        },
      },
    });

    expect(result).toEqual({ ok: false, error: 'disk full' });
  });
});
