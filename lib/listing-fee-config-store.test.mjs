import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ListingFeeConfigStore,
} = require('./listing-fee-config-store.js');

describe('ListingFeeConfigStore', () => {
  it('reads listing fee and trade tax config from the BidKing documents file', async () => {
    const documentsDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-documents-'));
    try {
      const configDir = path.join(documentsDir, 'BidKing');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, 'listing-fee-config.json'),
        JSON.stringify({
          listingFeeRate: 0.05,
          tradeTaxRate: 0.04,
          source: 'TradingExchange_Main.shouxufei',
        }),
        'utf8',
      );

      const store = new ListingFeeConfigStore({ documentsDir });

      expect(store.readConfig()).toEqual({
        listingFeeRate: 0.05,
        tradeTaxRate: 0.04,
        source: 'TradingExchange_Main.shouxufei',
      });
    } finally {
      await rm(documentsDir, { recursive: true, force: true });
    }
  });

  it('returns null when the config file is missing', async () => {
    const documentsDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-documents-'));
    try {
      const store = new ListingFeeConfigStore({ documentsDir });

      expect(store.readConfig()).toBeNull();
    } finally {
      await rm(documentsDir, { recursive: true, force: true });
    }
  });

  it('returns null when the config fields are invalid', async () => {
    const documentsDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-documents-'));
    try {
      const configDir = path.join(documentsDir, 'BidKing');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, 'listing-fee-config.json'),
        JSON.stringify({ listingFeeRate: 'x', tradeTaxRate: 0.04 }),
        'utf8',
      );

      const store = new ListingFeeConfigStore({ documentsDir });

      expect(store.readConfig()).toBeNull();
    } finally {
      await rm(documentsDir, { recursive: true, force: true });
    }
  });

  it.each([
    [{ listingFeeRate: null, tradeTaxRate: 0.04 }],
    [{ listingFeeRate: '', tradeTaxRate: '' }],
    [{ listingFeeRate: false, tradeTaxRate: 0.04 }],
    [{ listingFeeRate: [], tradeTaxRate: 0.04 }],
  ])('returns null when raw rate values are not numeric fields: %j', async (config) => {
    const documentsDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-documents-'));
    try {
      const configDir = path.join(documentsDir, 'BidKing');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, 'listing-fee-config.json'),
        JSON.stringify(config),
        'utf8',
      );

      const store = new ListingFeeConfigStore({ documentsDir });

      expect(store.readConfig()).toBeNull();
    } finally {
      await rm(documentsDir, { recursive: true, force: true });
    }
  });
});
