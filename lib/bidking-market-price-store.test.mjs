import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  MarketPriceStore,
  normalizeMarketPriceEvent,
} = require('./bidking-market-price-store.js');

describe('normalizeMarketPriceEvent', () => {
  it('turns market price events into sale price snapshots', () => {
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
    expect(normalizeMarketPriceEvent({
      type: 'market_price',
      itemCid: null,
      prices: [{ price: 1, count: 1 }],
    })).toBeNull();
    expect(normalizeMarketPriceEvent({
      type: 'market_price',
      itemCid: 1022001,
      prices: [],
    })).toBeNull();
  });
});

describe('MarketPriceStore', () => {
  it('appends snapshots, writes latest index, deduplicates exact duplicates, and reads history', async () => {
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

      expect(store.recordEvent(event)).toMatchObject({
        written: true,
        snapshot: { itemCid: 1022001 },
      });
      expect(store.recordEvent(event)).toMatchObject({
        written: false,
        reason: 'duplicate',
      });

      const snapshotsText = await readFile(
        path.join(outputDir, 'market-prices', 'snapshots.ndjson'),
        'utf8',
      );
      expect(snapshotsText.trim().split('\n')).toHaveLength(1);

      expect(store.readLatest()).toEqual({
        1022001: {
          observedAt: '2026-05-28T12:24:37.000Z',
          itemCid: 1022001,
          itemName: '急救毯',
          minPrice: 1155,
          maxPrice: 1194,
          totalCount: 114,
          tierCount: 2,
          source: 'tcp-passive',
        },
      });
      expect(store.readHistory(1022001, { limit: 10 })).toHaveLength(1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('deduplicates snapshots recorded before restart', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'market-price-store-'));
    try {
      const now = () => new Date('2026-05-28T12:24:37.000Z');
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

      const store1 = new MarketPriceStore({ outputDir, now });
      expect(store1.recordEvent(event)).toMatchObject({
        written: true,
        snapshot: { itemCid: 1022001 },
      });

      const store2 = new MarketPriceStore({ outputDir, now });
      expect(store2.recordEvent(event)).toMatchObject({
        written: false,
        reason: 'duplicate',
      });

      const snapshotsText = await readFile(
        path.join(outputDir, 'market-prices', 'snapshots.ndjson'),
        'utf8',
      );
      expect(snapshotsText.trim().split('\n')).toHaveLength(1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('setOutputDir rebinds paths and rehydrates dedup state from the target directory', async () => {
    const firstOutputDir = await mkdtemp(path.join(os.tmpdir(), 'market-price-store-first-'));
    const secondOutputDir = await mkdtemp(path.join(os.tmpdir(), 'market-price-store-second-'));
    try {
      const now = () => new Date('2026-05-28T12:24:37.000Z');
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
      const store = new MarketPriceStore({ outputDir: firstOutputDir, now });

      expect(store.recordEvent(event)).toMatchObject({ written: true });
      expect(store.recordEvent(event)).toMatchObject({
        written: false,
        reason: 'duplicate',
      });

      store.setOutputDir(secondOutputDir);
      expect(store.recordEvent(event)).toMatchObject({ written: true });

      const secondSnapshotsText = await readFile(
        path.join(secondOutputDir, 'market-prices', 'snapshots.ndjson'),
        'utf8',
      );
      expect(secondSnapshotsText.trim().split('\n')).toHaveLength(1);

      store.setOutputDir(firstOutputDir);
      expect(store.recordEvent(event)).toMatchObject({
        written: false,
        reason: 'duplicate',
      });
    } finally {
      await rm(firstOutputDir, { recursive: true, force: true });
      await rm(secondOutputDir, { recursive: true, force: true });
    }
  });

  it('rebuilds latest index from snapshots when latest json is corrupt', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'market-price-store-'));
    try {
      const store = new MarketPriceStore({
        outputDir,
        now: () => new Date('2026-05-28T12:24:37.000Z'),
      });
      store.recordEvent({
        type: 'market_price',
        clientMsgId: 99,
        itemCid: 1022001,
        itemName: '急救毯',
        requestUid: '1247189784563310',
        prices: [
          { price: 1155, count: 105 },
          { price: 1194, count: 9 },
        ],
      });

      await writeFile(
        path.join(outputDir, 'market-prices', 'latest.json'),
        '{invalid json',
        'utf8',
      );

      expect(store.readLatest()).toEqual({
        1022001: {
          observedAt: '2026-05-28T12:24:37.000Z',
          itemCid: 1022001,
          itemName: '急救毯',
          minPrice: 1155,
          maxPrice: 1194,
          totalCount: 114,
          tierCount: 2,
          source: 'tcp-passive',
        },
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
