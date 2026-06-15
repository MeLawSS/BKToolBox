import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  findTotalForAveragePrice,
  floorAverage,
  getValidAveragePriceCounts,
  getValidRoundedAverageCounts,
  getValidTotalValueCounts,
  getValueRange,
  isValidRoundedAverage,
  prepareItems,
  toSolverItem,
} from './solver-inputs.js';

const require = createRequire(import.meta.url);
const collectibles = require('../collectibles.json');
const goldByPrice = prepareItems(collectibles, (item) => item.quality === '金', 'price');
const goldByCells = prepareItems(collectibles, (item) => item.quality === '金', 'cells');

describe('solver input helpers', () => {
  it('maps root collectibles into solver items and sorts by the target key', () => {
    expect(toSolverItem(collectibles[0])).toEqual({
      name: collectibles[0].name,
      price: collectibles[0].price,
      w: collectibles[0].size.width,
      h: collectibles[0].size.height,
      cells: collectibles[0].size.width * collectibles[0].size.height,
    });

    expect(goldByCells).toHaveLength(100);
    expect(goldByCells[0]).toMatchObject({ name: '貔貅茶宠', price: 15345, cells: 1 });
    expect(getValueRange(goldByCells, 'cells')).toEqual({ min: 1, max: 18 });
  });

  it('finds totals within the average-price count tolerance', () => {
    expect(floorAverage(100, 3)).toBe(33.33);
    expect(findTotalForAveragePrice(33.33, 3)).toBe(100);
    expect(findTotalForAveragePrice(33.34, 3)).toBe(100);
    expect(findTotalForAveragePrice(33.35, 3)).toBeNull();
    expect(findTotalForAveragePrice(27197.45, 9)).toBe(244777);
    expect(findTotalForAveragePrice(10, 0)).toBeNull();
  });

  it('filters valid average-price counts by item price range', () => {
    expect(getValueRange(goldByPrice, 'price')).toEqual({ min: 7800, max: 199900 });
    expect(getValidAveragePriceCounts(10000, goldByPrice, { maxCount: 3 })).toEqual([
      { n: 1, total: 10000 },
      { n: 2, total: 20000 },
      { n: 3, total: 30000 },
    ]);
  });

  it('filters total-value counts by item value range', () => {
    expect(getValidTotalValueCounts(15345, goldByPrice, { maxCount: 4 })).toEqual([
      { n: 1, total: 15345 },
    ]);
  });

  it('validates rounded average counts using the existing 1% tolerance rule', () => {
    expect(isValidRoundedAverage(3.01, 1)).toBe(true);
    expect(isValidRoundedAverage(3.02, 1)).toBe(false);
    expect(getValidRoundedAverageCounts(1, goldByCells, { maxCount: 4 })).toEqual([
      { n: 1, total: 1 },
      { n: 2, total: 2 },
      { n: 3, total: 3 },
      { n: 4, total: 4 },
    ]);
  });
});
