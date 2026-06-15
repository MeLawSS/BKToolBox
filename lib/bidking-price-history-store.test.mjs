import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PriceHistoryStore,
} = require('./bidking-price-history-store.js');

describe('PriceHistoryStore', () => {
  it('persists per-item observed time and minimum price with a latest index', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-price-history-'));
    try {
      const store = new PriceHistoryStore({ rootDir });
      const snapshot = {
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
      };

      expect(store.recordSnapshot(snapshot)).toEqual({
        written: true,
        record: {
          observedAt: '2026-05-28T12:24:37.000Z',
          itemCid: 1022001,
          minPrice: 1155,
        },
      });
      expect(store.recordSnapshot(snapshot)).toEqual({
        written: false,
        reason: 'duplicate',
        record: {
          observedAt: '2026-05-28T12:24:37.000Z',
          itemCid: 1022001,
          minPrice: 1155,
        },
      });

      const csv = await readFile(path.join(rootDir, 'items', '1022001.csv'), 'utf8');
      expect(csv).toBe([
        'observedAt,minPrice',
        '2026-05-28T12:24:37.000Z,1155',
        '',
      ].join('\n'));
      expect(store.readLatest()).toEqual({
        1022001: {
          observedAt: '2026-05-28T12:24:37.000Z',
          itemCid: 1022001,
          minPrice: 1155,
        },
      });
      expect(store.readHistory(1022001)).toEqual([
        {
          observedAt: '2026-05-28T12:24:37.000Z',
          minPrice: 1155,
        },
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('reads unique valid collection cids from Cids.json', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-price-history-'));
    try {
      await mkdir(rootDir, { recursive: true });
      await writeFile(
        path.join(rootDir, 'Cids.json'),
        JSON.stringify([1022002, '1022001', 0, 'abc', 1022002, 1022003]),
        'utf8',
      );

      const store = new PriceHistoryStore({ rootDir });

      expect(store.readCollectionCids()).toEqual([1022002, 1022001, 1022003]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
