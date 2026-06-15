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
      expect(store.readLadders(1083009, { hours: 24, now: new Date('2026-06-01T03:00:00.000Z') })).toEqual([
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
      expect(store.readLadders(1083009, { hours: -1, now: new Date('2026-06-01T03:00:00.000Z') })).toEqual([
        { observedAt: '2026-06-01T01:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6200, count: 2 }] },
        { observedAt: '2026-06-01T02:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6400, count: 1 }] },
      ]);
      expect(store.readLadders(1083009, { hours: 'bad', now: new Date('2026-06-01T03:00:00.000Z') })).toEqual([
        { observedAt: '2026-06-01T01:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6200, count: 2 }] },
        { observedAt: '2026-06-01T02:00:00.000Z', itemCid: 1083009, tiers: [{ price: 6400, count: 1 }] },
      ]);
      expect(store.readLadders(1083009, { hours: 72, limit: 2, now: new Date('2026-06-01T03:00:00.000Z') })).toEqual([
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
    expect(normalizeLadderRecord({
      itemCid: 1083009,
      observedAt: '2026-06-01T00:00:00.000Z',
      tiers: [
        { price: 6200, count: 2 },
        { price: 6400, count: 0 },
      ],
    })).toBeNull();
  });
});
