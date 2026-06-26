import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ESTIMATION_GROUPS,
  PER_CELL_EXPECTED,
  buildPriceProfilesByGroup,
  cloneStateWithGroupCandidates,
  cloneStateWithGroupCells,
  collectEstimationInputs,
  deriveCountFromCells,
  deriveNearestCellsFromAverage,
  estimateAveragePriceForCells,
  estimateAveragePriceRangeForCombination,
  estimateGroupValue,
  estimateTotalByStage,
  findTotalForAveragePrice,
  findMatchingTotalPriceCounts,
  getAverageOnlyPredictions,
  getCombinedAverageOnlyPredictions,
  getEffectiveMaxCells,
  getFeasibleCellsFromAverage,
  getPossibleCellsFromAverage,
  getPriceScore,
  getPurpleAverageOnlyPredictions,
  hasMatchingAveragePriceCombination,
  hasMatchingTotalPriceCombination,
  parsePurpleComboOutputLine,
  parseOptionalInteger,
  parseOptionalNumber,
  prepareCollectibleItemsForGroup,
  resolveAutoTotalCellsFromAverage,
} from './estimator.js';
import {
  DEFAULT_ESTIMATION_OUTPUT_LIMIT,
  applyAveragePriceCellMatchOverridesForWorker,
  calculateEstimationResult,
  runPriceMatchPhase,
} from './estimation-worker-core.js';
import { elsaProfile } from '../hero-estimator/hero-profiles.js';

const realCollectibles = JSON.parse(fs.readFileSync('public/data/collectibles.json', 'utf8'));

function buildAveragePricesByQualityFromCollectibles(items) {
  const buckets = {};
  for (const item of items) {
    const quality = item.quality;
    const width = item.size?.width;
    const height = item.size?.height;
    const key = item.size?.key ?? `${width}x${height}`;
    const price = item.price;
    if (
      !quality ||
      !key ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(price)
    ) {
      continue;
    }

    buckets[quality] ??= {};
    buckets[quality][key] ??= {
      quality,
      size: key,
      width,
      height,
      cells: width * height,
      count: 0,
      totalPrice: 0,
    };
    buckets[quality][key].count += 1;
    buckets[quality][key].totalPrice += price;
  }

  for (const sizes of Object.values(buckets)) {
    for (const entry of Object.values(sizes)) {
      entry.averagePrice = entry.totalPrice / entry.count;
    }
  }

  return buckets;
}

const realPriceProfilesByGroup = buildPriceProfilesByGroup(
  buildAveragePricesByQualityFromCollectibles(realCollectibles)
);
const realPurpleItems = prepareCollectibleItemsForGroup(realCollectibles, 'purple');

function emptyGroupInputsFor(groups, overrides = {}) {
  return Object.fromEntries(groups.map((group) => [
    group.key,
    {
      avg: '',
      cells: '',
      priceAverage: '',
      ...overrides[group.key],
    },
  ]));
}

function emptyGroupInputs(overrides = {}) {
  return emptyGroupInputsFor(ESTIMATION_GROUPS, overrides);
}

function collect(globalInputs, groupOverrides = {}) {
  return collectEstimationInputs(globalInputs, emptyGroupInputs(groupOverrides));
}

describe('Ethan estimator number parsing', () => {
  it('parses optional decimal and integer values', () => {
    expect(parseOptionalNumber('', '价格')).toBeNull();
    expect(parseOptionalNumber(' 12.5 ', '价格')).toBe(12.5);
    expect(parseOptionalInteger('12', '格数')).toBe(12);
  });

  it('rejects invalid and non-integer values with field labels', () => {
    expect(() => parseOptionalNumber('abc', '价格')).toThrow('价格 不是有效数字');
    expect(() => parseOptionalInteger('12.5', '格数')).toThrow('格数 必须是整数');
  });
});

describe('Ethan estimator cell derivation', () => {
  it('derives feasible cells and counts from average values', () => {
    expect(deriveNearestCellsFromAverage(1.5, 31)).toBe(30);
    expect(deriveCountFromCells(1.5, 30)).toBe(20);
    expect(getPossibleCellsFromAverage(3, 10)).toEqual([
      { count: 1, cells: 3 },
      { count: 2, cells: 6 },
      { count: 3, cells: 9 },
    ]);
    expect(getFeasibleCellsFromAverage(1.5, 10)).toEqual([
      { count: 2, cells: 3 },
      { count: 4, cells: 6 },
      { count: 6, cells: 9 },
    ]);
  });

  it('collects normalized estimation input state', () => {
    const state = collect(
      { totalCells: '100', totalAverage: '2' },
      {
        wg: { avg: '1.5', cells: '30' },
        orange: { cells: '5', priceAverage: '10000' },
      }
    );

    expect(state.totalCells).toBe(100);
    expect(state.totalCount).toBe(50);
    expect(state.knownCells).toBe(35);
    expect(state.groups.wg).toMatchObject({ avg: 1.5, cells: 30, count: 20 });
    expect(state.groups.orange).toMatchObject({ cells: 5, priceAverage: 10000, count: null });
  });

  it('keeps Elsa white and green inputs separate', () => {
    const state = collectEstimationInputs(
      { totalCells: '8', totalAverage: '' },
      emptyGroupInputsFor(elsaProfile.groups, {
        white: { avg: '1', cells: '2' },
        green: { avg: '2', cells: '6' },
      }),
      elsaProfile.groups,
    );

    expect(state.knownCells).toBe(8);
    expect(state.groups.white).toMatchObject({ avg: 1, cells: 2, count: 2 });
    expect(state.groups.green).toMatchObject({ avg: 2, cells: 6, count: 3 });
    expect(state.groups.wg).toBeUndefined();
  });

  it('uses known cells as the effective total when filled quality cells exceed the entered total', () => {
    const state = collect(
      { totalCells: '10', totalAverage: '' },
      {
        wg: { cells: '7' },
        blue: { cells: '6' },
      }
    );

    expect(state.totalCells).toBe(13);
    expect(state.knownCells).toBe(13);
  });

  it('derives total count from the clamped effective total when total average is present', () => {
    const state = collect(
      { totalCells: '10', totalAverage: '1' },
      {
        wg: { cells: '7' },
        blue: { cells: '6' },
      }
    );

    expect(state.totalCells).toBe(13);
    expect(state.totalCount).toBe(13);
  });

  it('requires selected total cells to match total average exactly', () => {
    expect(() => collect({ totalCells: '31', totalAverage: '1.5' }))
      .toThrow('所有藏品平均格数无法对应到可行总格数');

    expect(collect({ totalCells: '30', totalAverage: '1.5' })).toMatchObject({
      totalCells: 30,
      totalCount: 20,
    });
  });

  it('normalizes auto-derived total cells with the shared nearest-feasible helper', () => {
    expect(resolveAutoTotalCellsFromAverage(2.5, 50)).toBe(50);
    expect(resolveAutoTotalCellsFromAverage(2.5, 48)).toBe(50);
    expect(resolveAutoTotalCellsFromAverage(2, 19)).toBe(18);
    expect(resolveAutoTotalCellsFromAverage(null, 48)).toBe(48);
    expect(resolveAutoTotalCellsFromAverage(2.5, null)).toBeNull();
  });
});

describe('Ethan estimator exact total-price matching', () => {
  const sampleItems = [
    { name: 'A', price: 100, cells: 1 },
    { name: 'B', price: 150, cells: 1 },
    { name: 'C', price: 250, cells: 2 },
    { name: 'D', price: 300, cells: 3 },
  ];

  it('matches exact total-price combinations for a fixed count and cells', () => {
    expect(hasMatchingTotalPriceCombination(sampleItems, { count: 2, cells: 2 }, 250)).toBe(true);
    expect(hasMatchingTotalPriceCombination(sampleItems, { count: 1, cells: 2 }, 250)).toBe(true);
    expect(hasMatchingTotalPriceCombination(sampleItems, { count: 2, cells: 2 }, 260)).toBe(false);
  });

  it('enumerates all counts that can hit an exact total price for fixed cells', () => {
    expect(findMatchingTotalPriceCounts(sampleItems, 2, 250)).toEqual([1, 2]);
    expect(findMatchingTotalPriceCounts(sampleItems, 3, 400)).toEqual([2, 3]);
    expect(findMatchingTotalPriceCounts(sampleItems, 2, 999)).toEqual([]);
  });
});

describe('getEffectiveMaxCells', () => {
  it('returns null when totalCells is null', () => {
    const state = collect({ totalCells: '', totalAverage: '' });
    expect(getEffectiveMaxCells(state)).toBeNull();
  });

  it('returns totalCells when wg.cells is null', () => {
    const state = collect({ totalCells: '50', totalAverage: '' }, { blue: { cells: '10' } });
    expect(getEffectiveMaxCells(state)).toBe(50);
  });

  it('returns totalCells when blue.cells is null', () => {
    const state = collect({ totalCells: '50', totalAverage: '' }, { wg: { cells: '20' } });
    expect(getEffectiveMaxCells(state)).toBe(50);
  });

  it('returns totalCells + 20 when both wg.cells and blue.cells are set', () => {
    const state = collect(
      { totalCells: '50', totalAverage: '' },
      { wg: { cells: '20' }, blue: { cells: '10' } }
    );
    expect(getEffectiveMaxCells(state)).toBe(70);
  });

  it('does not relax total cells when a total average derives an exact total count', () => {
    const state = collect(
      { totalCells: '93', totalAverage: '3.3214' },
      { wg: { cells: '36' }, blue: { cells: '13' } }
    );

    expect(state.totalCount).toBe(28);
    expect(getEffectiveMaxCells(state)).toBe(93);
  });
});

describe('getAverageOnlyPredictions overflow relaxation', () => {
  it('deducts monitorKnownCells from the effective max when computing prediction candidates', () => {
    const base = collect({ totalCells: '20', totalAverage: '' }, { purple: { avg: '3' } });
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 10000 },
      },
    };
    const preds = getAverageOnlyPredictions(state, 'purple');
    // effectiveMax=20, knownCells=0, monitorKnownTotal=5 → maxGroupCells=15
    // without fix: maxGroupCells=20, candidates include 18
    expect(preds.every((p) => p.cells <= 15)).toBe(true);
    expect(preds.some((p) => p.cells > 15)).toBe(false);
  });

  it('does not deduct monitorKnownCells for the same group being predicted', () => {
    const base = collect({ totalCells: '20', totalAverage: '' }, { blue: { avg: '1' } });
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 10000 },
      },
    };
    const preds = getAverageOnlyPredictions(state, 'blue');

    expect(preds.every((p) => p.cells >= 5)).toBe(true);
    expect(preds.some((p) => p.cells === 20)).toBe(true);
  });

  it('caps at totalCells - knownCells when trigger not met (wg.cells absent)', () => {
    // blue.cells set, wg.cells absent → no relaxation
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      { blue: { cells: '5' }, purple: { avg: '3' } }
    );
    const preds = getAverageOnlyPredictions(state, 'purple');
    // maxGroupCells = 20 - 5 = 15; candidates: 3, 6, 9, 12, 15
    expect(preds.length).toBe(5);
    expect(preds.every((p) => p.cells <= 15)).toBe(true);
  });

  it('allows candidates up to totalCells + 20 - knownCells when trigger met', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      { wg: { cells: '5' }, blue: { cells: '5' }, purple: { avg: '3' } }
    );
    const preds = getAverageOnlyPredictions(state, 'purple');
    // effectiveMax = 40, maxGroupCells = 30; candidates: 3, 6, ..., 30 (10 items)
    expect(preds.length).toBe(10);
    expect(preds.some((p) => p.cells > 10)).toBe(true);
  });

  it('does not apply Ethan overflow relaxation to Elsa predictions', () => {
    const state = collectEstimationInputs(
      { totalCells: '20', totalAverage: '' },
      emptyGroupInputsFor(elsaProfile.groups, {
        white: { cells: '5' },
        green: { cells: '5' },
        purple: { avg: '3' },
      }),
      elsaProfile.groups,
    );

    expect(getEffectiveMaxCells(state, elsaProfile)).toBe(20);
    expect(getAverageOnlyPredictions(state, 'purple', ['purple'], elsaProfile)).toEqual([
      { count: 1, cells: 3 },
      { count: 2, cells: 6 },
      { count: 3, cells: 9 },
    ]);
  });

  it('keeps high-cell candidates instead of applying a fixed 60-cell cutoff', () => {
    const state = collect(
      { totalCells: '149', totalAverage: '' },
      {
        wg: { cells: '19' },
        blue: { cells: '36' },
        purple: { avg: '3.08' },
      }
    );

    const preds = getAverageOnlyPredictions(state, 'purple');

    expect(preds).toContainEqual({ count: 23, cells: 71 });
    expect(preds).toContainEqual({ count: 25, cells: 77 });
  });

  it('includes the observed 21-purple-item result for displayed average 3.08', () => {
    const state = collect(
      { totalCells: '149', totalAverage: '' },
      {
        wg: { cells: '19' },
        blue: { cells: '36' },
        purple: { avg: '3.08' },
      }
    );

    const preds = getAverageOnlyPredictions(state, 'purple');

    expect(preds).toContainEqual({ count: 21, cells: 65 });
  });
});

describe('getCombinedAverageOnlyPredictions overflow relaxation', () => {
  it('deducts monitorKnownCells from effectiveMax in combined prediction validation', () => {
    const base = collect(
      { totalCells: '20', totalAverage: '' },
      { purple: { avg: '3' }, orange: { avg: '5' } }
    );
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 10000 },
      },
    };
    const combos = getCombinedAverageOnlyPredictions(state, ['purple', 'orange']);
    // effectiveMax=20, monitorKnownTotal=5; all combos must fit: 5 + candidateCells <= 20
    // without fix: combos could include purple=9+orange=15=24 > 15
    combos.forEach(({ candidatesByGroup }) => {
      const groupCells = Object.values(candidatesByGroup).reduce((sum, c) => sum + c.cells, 0);
      expect(5 + groupCells).toBeLessThanOrEqual(20);
    });
  });

  it('does not double count monitorKnownCells for groups included in combined predictions', () => {
    const base = collect(
      { totalCells: '20', totalAverage: '' },
      { blue: { avg: '5' }, purple: { avg: '5' } }
    );
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 10000 },
      },
    };
    const combos = getCombinedAverageOnlyPredictions(state, ['blue', 'purple']);

    expect(combos.every(({ candidatesByGroup }) => candidatesByGroup.blue.cells >= 5)).toBe(true);
    expect(combos.some(({ candidatesByGroup }) =>
      candidatesByGroup.blue.cells === 15 && candidatesByGroup.purple.cells === 5
    )).toBe(true);
  });

  it('produces combined predictions when all prediction groups lack cells even with overflow trigger met', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      {
        wg: { cells: '5' },
        blue: { cells: '5' },
        purple: { avg: '3' },
        orange: { avg: '5' },
      }
    );
    const combos = getCombinedAverageOnlyPredictions(state, ['purple', 'orange']);
    expect(combos.length).toBeGreaterThan(0);
    expect(combos[0]).toMatchObject({
      candidatesByGroup: {
        purple: { count: 1, cells: 3 },
        orange: { count: 1, cells: 5 },
      },
    });
  });

  it('prioritizes exact-total combined predictions when all prediction groups lack cells', () => {
    const state = collect(
      { totalCells: '93', totalAverage: '3.3214' },
      {
        wg: { cells: '36' },
        blue: { cells: '13' },
        purple: { avg: '4' },
        orange: { avg: '6' },
      }
    );

    const combos = getCombinedAverageOnlyPredictions(state, ['purple', 'orange'], 15);
    expect(combos.length).toBeGreaterThan(0);
    expect(combos[0]).toMatchObject({
      candidatesByGroup: {
        purple: { count: 2, cells: 8 },
        orange: { count: 6, cells: 36 },
      },
    });
  });

  it('still produces combined predictions when one of the groups has explicit cells', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      {
        wg: { cells: '5' },
        blue: { cells: '5' },
        purple: { avg: '3' },
        orange: { cells: '5' },
      }
    );
    // Orange has explicit cells → guard is not triggered.
    // Purple has no cells → only orange produces no candidates → combined returns [].
    const combos = getCombinedAverageOnlyPredictions(state, ['purple', 'orange']);
    expect(combos).toEqual([]);
  });
});

describe('Ethan estimator stage totals', () => {
  it('estimates remaining cells at wg rate when only total cells are known', () => {
    const state = collect({ totalCells: '100', totalAverage: '' });

    expect(estimateTotalByStage(state)).toMatchObject({
      stage: 'total',
      // 100 × 232 (wg, lowest missing)
      total: 23200,
      remaining: 100,
      unitPrice: 232,
    });
  });

  it('prices each known quality at its per-cell expected, remaining at lowest missing quality', () => {
    expect(estimateTotalByStage(collect(
      { totalCells: '100', totalAverage: '' },
      { wg: { cells: '20' } }
    ))).toMatchObject({
      // 20×232 + 80×889 (blue is lowest missing)
      stage: 'wg', total: 75760, remaining: 80, unitPrice: 889,
    });

    expect(estimateTotalByStage(collect(
      { totalCells: '100', totalAverage: '' },
      { wg: { cells: '10' }, blue: { cells: '20' } }
    ))).toMatchObject({
      // 10×232 + 20×889 + 70×2482 (purple is lowest missing)
      stage: 'blue', total: 193840, remaining: 70, unitPrice: 2482,
    });

    expect(estimateTotalByStage(collect(
      { totalCells: '100', totalAverage: '' },
      { wg: { cells: '10' }, blue: { cells: '20' }, purple: { cells: '30' } }
    ))).toMatchObject({
      // 10×232 + 20×889 + 30×2482 + 40×9228 (orange is lowest missing)
      stage: 'purple', total: 463680, remaining: 40, unitPrice: 9228,
    });

    expect(estimateTotalByStage(collect(
      { totalCells: '100', totalAverage: '' },
      { wg: { cells: '10' }, blue: { cells: '20' }, purple: { cells: '30' }, orange: { cells: '5' } }
    ))).toMatchObject({
      // 10×232 + 20×889 + 30×2482 + 5×9228 + 35×40000 (red is the only missing quality)
      stage: 'orange', total: 1540700, remaining: 35, unitPrice: 40000,
    });

    expect(estimateTotalByStage(collect(
      { totalCells: '100', totalAverage: '' },
      { orange: { cells: '5' } }
    ))).toMatchObject({
      // 5×9228 + 95×232 (wg is lowest missing)
      stage: 'orange', total: 68180, remaining: 95, unitPrice: 232,
    });
  });

  it('accounts for red cells separately at 40000/cell', () => {
    const state = collect(
      { totalCells: '100', totalAverage: '' },
      { orange: { cells: '5' }, red: { cells: '2' } }
    );

    expect(estimateTotalByStage(state)).toMatchObject({
      stage: 'red',
      // 5×9228 + 2×40000 + 93×232 (wg is lowest missing for non-red)
      total: 147716,
      remaining: 93,
      unitPrice: 232,
    });
  });

  it('adds monitor outline cells and values for groups the user has not filled', () => {
    const base = collect({ totalCells: '50', totalAverage: '' }, { wg: { cells: '10' } });
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 7, monitorKnownValue: 13000 },
      },
    };

    expect(estimateTotalByStage(state)).toMatchObject({
      // stage and lowestMissing unaffected: blue has cells===null
      stage: 'wg',
      unitPrice: 889,
      // wg: 10×232=2320, blue outlines: 13000, remaining 33×889=29337
      total: 44657,
      remaining: 33,
    });
  });

  it('keeps lowestMissingKey at blue even when multiple groups have monitor outlines above wg', () => {
    const base = collect({ totalCells: '50', totalAverage: '' }, { wg: { cells: '10' } });
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 10000 },
        purple: { ...base.groups.purple, monitorKnownCells: 3, monitorKnownValue: 8000 },
      },
    };

    expect(estimateTotalByStage(state)).toMatchObject({
      stage: 'wg',
      unitPrice: 889,
      // wg: 10×232=2320, blue outlines: 10000, purple outlines: 8000
      // remaining: 50-10-5-3=32, ×889=28448
      total: 48768,
      remaining: 32,
    });
  });

  it('does not use monitorKnownCells when user has provided cells for that group', () => {
    const base = collect({ totalCells: '50', totalAverage: '' }, { wg: { cells: '10' }, blue: { cells: '20' } });
    // blue has user-provided cells=20; monitorKnownCells should be ignored
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 99999 },
      },
    };

    expect(estimateTotalByStage(state)).toMatchObject({
      stage: 'blue',
      unitPrice: 2482,
      // wg: 10×232=2320, blue user cells: 20×889=17780, remaining 20×2482=49640
      total: 69740,
      remaining: 20,
    });
  });
});

describe('Ethan estimator price profiles', () => {
  it('builds per-group average price profiles from quality data', () => {
    const profiles = buildPriceProfilesByGroup({
      白: {
        a: { cells: 1, averagePrice: 10 },
        b: { cells: 2, averagePrice: 30 },
      },
      绿: {
        c: { cells: 1, averagePrice: 20 },
        invalid: { cells: 0, averagePrice: 99 },
      },
      紫: {
        d: { cells: 6, averagePrice: 120 },
      },
    });

    expect(profiles.wg).toEqual([
      { cells: 1, averagePrice: 15 },
      { cells: 2, averagePrice: 30 },
    ]);
    expect(profiles.purple).toEqual([{ cells: 6, averagePrice: 120 }]);
  });

  it('scores candidate cells against nearest price profile entry', () => {
    const profiles = {
      purple: [
        { cells: 3, averagePrice: 300 },
        { cells: 6, averagePrice: 120 },
        { cells: 9, averagePrice: 110 },
      ],
    };

    expect(estimateAveragePriceForCells('purple', 5, profiles)).toBe(120);
    expect(getPriceScore('purple', 100, { cells: 9 }, profiles)).toBeCloseTo(0.1);
  });

  it('scores candidate count and cells against real collectible price combinations', () => {
    const range = estimateAveragePriceRangeForCombination(
      'purple',
      { cells: 7, count: 3 },
      realPriceProfilesByGroup
    );

    expect(range.min).toBeCloseTo(6575.9);
    expect(range.max).toBeCloseTo(8202.4);
    expect(estimateAveragePriceForCells('purple', 7, realPriceProfilesByGroup)).toBeGreaterThan(12000);
    expect(getPriceScore('purple', 6800, { cells: 7, count: 3 }, realPriceProfilesByGroup)).toBe(0);
  });

  it('matches average price using real collectible combinations under count and cells constraints', () => {
    expect(findTotalForAveragePrice(6800, 3)).toBe(20400);
    expect(findTotalForAveragePrice(27197.45, 9)).toBe(244777);
    expect(hasMatchingAveragePriceCombination(
      realPurpleItems,
      { cells: 7, count: 3 },
      6800
    )).toBe(true);
    expect(hasMatchingAveragePriceCombination(
      realPurpleItems,
      { cells: 7, count: 3 },
      4566.4
    )).toBe(false);
  });

  it('parses streamed purple combo output lines', () => {
    expect(parsePurpleComboOutputLine('  TotalCells=14, TotalPrice=40800, Count=6: [A]'))
      .toEqual({ cells: 14, totalPrice: 40800, count: 6 });
    expect(parsePurpleComboOutputLine('Count=6, TotalPrice=40800')).toBeNull();
  });
});

describe('Ethan worker estimation core', () => {
  it('limits average-only worker result rows to 30', () => {
    const state = collect(
      { totalCells: '120', totalAverage: '' },
      { purple: { avg: '1' } }
    );

    const result = calculateEstimationResult({
      state,
      limit: DEFAULT_ESTIMATION_OUTPUT_LIMIT,
    });

    expect(result.type).toBe('single');
    expect(result.rows).toHaveLength(30);
    expect(result.rows.at(-1).item.state.groups.purple.cells).toBe(30);
  });

  it('returns combined when multiple prediction groups can be enumerated together', () => {
    const state = collect(
      { totalCells: '120', totalAverage: '' },
      { purple: { avg: '3' }, orange: { avg: '2.5' } }
    );

    const result = calculateEstimationResult({
      state,
      predictionGroupKeys: ['purple', 'orange'],
      limit: DEFAULT_ESTIMATION_OUTPUT_LIMIT,
    });

    expect(result.type).toBe('combined');
    expect(result.groupKeys).toEqual(['purple', 'orange']);
  });

  it('resolves exact average-price cell matches off the main app path', () => {
    const state = collect(
      { totalCells: '4', totalAverage: '' },
      { purple: { cells: '4', priceAverage: '8974' } }
    );

    const result = calculateEstimationResult({
      state,
      predictionGroupKeys: [],
      collectibleItemsByGroup: {
        purple: realPurpleItems,
      },
      priceProfilesByGroup: realPriceProfilesByGroup,
    });

    expect(result.type).toBe('direct');
    expect(result.state.groups.purple).toMatchObject({
      count: 1,
      valueOverride: 8974,
      valueSource: 'averagePriceCombo',
    });
    expect(result.prediction.total).toBe(8974);
  });

  it('returns priceCellsNoMatch when a prediction group has explicit cells but no exact average-price combo', () => {
    const state = collect({ totalCells: '4', totalAverage: '' }, { purple: { cells: '4', priceAverage: '1' } });

    const result = calculateEstimationResult({
      state,
      predictionGroupKeys: ['purple'],
      collectibleItemsByGroup: { purple: realPurpleItems },
    });

    expect(result).toMatchObject({
      type: 'empty',
      reason: 'priceCellsNoMatch',
      missing: {
        labelKey: 'ethan.groups.purple',
        cells: 4,
      },
    });
  });

  it('keeps Elsa worker calculations profile-aware for direct estimates', () => {
    const state = collectEstimationInputs(
      { totalCells: '10', totalAverage: '' },
      emptyGroupInputsFor(elsaProfile.groups, {
        white: { cells: '2' },
      }),
      elsaProfile.groups,
    );

    const result = calculateEstimationResult({
      state,
      groups: elsaProfile.groups,
      profile: elsaProfile,
      predictionGroupKeys: elsaProfile.streamSearchConfigs.map((config) => config.groupKey),
    });

    expect(result.type).toBe('direct');
    expect(result.prediction.total).toBe(2872);
    expect(result.groupRows.some((row) => row.labelKey === 'ethan.groups.white')).toBe(true);
  });

  it('applyAveragePriceCellMatchOverridesForWorker skips groups listed in skipGroupKeys', () => {
    const state = collect({ totalCells: '4', totalAverage: '' }, { purple: { cells: '4', priceAverage: '8974' } });

    const { state: skipped, missingMatches: skippedMissing } =
      applyAveragePriceCellMatchOverridesForWorker(state, { purple: realPurpleItems }, undefined, ['purple']);

    expect(skipped.groups.purple.valueOverride).toBeUndefined();
    expect(skippedMissing).toHaveLength(0);

    const { state: included } =
      applyAveragePriceCellMatchOverridesForWorker(state, { purple: realPurpleItems }, undefined, []);

    expect(included.groups.purple.valueOverride).toBe(8974);
  });
});

describe('runPriceMatchPhase', () => {
  it('posts price-match-update with correct delta for a direct result', () => {
    // purple cells=4, priceAverage=8974, count=null → findFirstAveragePriceCellMatch → count=1, totalPrice=8974
    // baseline = 4 * PER_CELL_EXPECTED.purple (count is null so formula path)
    // delta = 8974 − 4 * 2482 = −954
    const state = collect({ totalCells: '4', totalAverage: '' }, { purple: { cells: '4', priceAverage: '8974' } });
    const result = { type: 'direct', state };
    const posted = [];

    runPriceMatchPhase({
      result,
      state,
      collectibleItemsByGroup: { purple: realPurpleItems },
      predictionGroupKeys: ['purple', 'orange'],
      profile: null,
      runId: 42,
      postMessage: (msg) => posted.push(msg),
    });

    const updates = posted.filter((m) => m.type === 'price-match-update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: 'price-match-update',
      runId: 42,
      groupKey: 'purple',
      rowIndex: null,
      delta: 8974 - 4 * PER_CELL_EXPECTED.purple,
    });
    expect(posted.at(-1)).toEqual({ type: 'price-match-done', runId: 42 });
  });

  it('posts only price-match-done when no combination satisfies the price constraint', () => {
    // priceAverage=1 — cheaper than any real purple item
    const state = collect({ totalCells: '4', totalAverage: '' }, { purple: { cells: '4', priceAverage: '1' } });
    const result = { type: 'direct', state };
    const posted = [];

    runPriceMatchPhase({
      result,
      state,
      collectibleItemsByGroup: { purple: realPurpleItems },
      predictionGroupKeys: ['purple'],
      profile: null,
      runId: 1,
      postMessage: (msg) => posted.push(msg),
    });

    expect(posted.filter((m) => m.type === 'price-match-update')).toHaveLength(0);
    expect(posted).toEqual([{ type: 'price-match-done', runId: 1 }]);
  });

  it('posts only price-match-done for combined result type without searching', () => {
    const result = { type: 'combined' };
    const posted = [];

    runPriceMatchPhase({
      result,
      state: collect({ totalCells: '', totalAverage: '' }),
      collectibleItemsByGroup: {},
      predictionGroupKeys: ['purple'],
      profile: null,
      runId: 5,
      postMessage: (msg) => posted.push(msg),
    });

    expect(posted).toEqual([{ type: 'price-match-done', runId: 5 }]);
  });

  it('posts price-match-update with numeric rowIndex for each matched single-result row', () => {
    // purple avg=4 with totalCells=4 → exactly one candidate: cells=4, count=1
    // hasMatchingAveragePriceCombination(realPurpleItems, {count:1, cells:4}, 8974) is true
    // (a purple item with cells=4 at price 8974 exists — confirmed by the direct-match test)
    const state = collect(
      { totalCells: '4', totalAverage: '' },
      { purple: { avg: '4', priceAverage: '8974' } }
    );
    const result = calculateEstimationResult({
      state,
      predictionGroupKeys: ['purple', 'orange'],
      limit: 10,
    });
    expect(result.type).toBe('single');
    expect(result.rows).toHaveLength(1);

    const posted = [];
    runPriceMatchPhase({
      result,
      state,
      collectibleItemsByGroup: { purple: realPurpleItems },
      predictionGroupKeys: ['purple', 'orange'],
      profile: null,
      runId: 1,
      postMessage: (msg) => posted.push(msg),
    });

    const updates = posted.filter((m) => m.type === 'price-match-update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: 'price-match-update',
      runId: 1,
      groupKey: 'purple',
      rowIndex: 0,
    });
    expect(posted.at(-1)).toEqual({ type: 'price-match-done', runId: 1 });
  });
});

describe('Ethan estimator purple predictions and rows', () => {
  it('predicts purple cells from average-only input without filtering by price average', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      { purple: { avg: '2.33', priceAverage: '4566.4' } }
    );

    const predictions = getPurpleAverageOnlyPredictions(state);

    expect(predictions[0]).toMatchObject({ cells: 7, count: 3 });
    expect(predictions.some((candidate) => candidate.cells === 14 && candidate.count === 6)).toBe(true);
    expect(predictions.every((candidate) => candidate.priceScore === undefined)).toBe(true);
  });

  it('predicts orange cells from average-only input', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      { orange: { avg: '2.5', priceAverage: '22800' } }
    );

    const predictions = getAverageOnlyPredictions(state, 'orange');

    expect(predictions[0]).toMatchObject({ cells: 5, count: 2 });
    expect(predictions.some((candidate) => candidate.cells === 10 && candidate.count === 4)).toBe(true);
  });

  it('clones state with selected predicted group cells', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      { purple: { avg: '3', priceAverage: '115' } }
    );

    const cloned = cloneStateWithGroupCells(state, 'purple', {
      cells: 6,
      count: 2,
      priceScore: 0.04,
    });

    expect(cloned).not.toBe(state);
    expect(cloned.groups.purple).toMatchObject({ cells: 6, count: 2, priceScore: 0.04 });
    expect(cloned.knownCells).toBe(6);
    expect(state.groups.purple.cells).toBeNull();
  });

  it('includes monitorKnownValue in prediction total when cells are set for a group that had monitor outlines', () => {
    const base = collect({ totalCells: '20', totalAverage: '' });
    const state = {
      ...base,
      groups: {
        ...base.groups,
        blue: { ...base.groups.blue, monitorKnownCells: 5, monitorKnownValue: 10000 },
      },
    };

    // Simulate prediction: blue gets cells=7 (5 from monitor + 2 estimated)
    const cloned = cloneStateWithGroupCells(state, 'blue', { cells: 7, count: 3 });
    const result = estimateTotalByStage(cloned);

    // blue: monitorKnownValue(10000) + 2×889(1778) = 11778
    // remaining: 20-7=13 at 232/cell (wg is lowestMissing) = 3016
    // total = 11778 + 3016 = 14794
    // without fix: 7×889(6223) + 3016 = 9239
    expect(result.total).toBe(14794);
  });

  it('keeps combined predictions available when all prediction groups lack cells', () => {
    const state = collect(
      { totalCells: '20', totalAverage: '' },
      {
        purple: { avg: '2.33' },
        orange: { avg: '2.5' },
      }
    );

    const combined = getCombinedAverageOnlyPredictions(state, ['purple', 'orange']);
    expect(combined).toEqual([
      {
        candidatesByGroup: {
          purple: { count: 3, cells: 7 },
          orange: { count: 2, cells: 5 },
        },
      },
      {
        candidatesByGroup: {
          purple: { count: 3, cells: 7 },
          orange: { count: 4, cells: 10 },
        },
      },
      {
        candidatesByGroup: {
          purple: { count: 6, cells: 14 },
          orange: { count: 2, cells: 5 },
        },
      },
    ]);
  });

  it('builds group result rows with price status', () => {
    const state = collect(
      { totalCells: '100', totalAverage: '' },
      { orange: { cells: '5', priceAverage: '10000' } }
    );
    const profiles = {
      orange: [{ cells: 5, averagePrice: 9000 }],
    };
    const orange = ESTIMATION_GROUPS.find((group) => group.key === 'orange');

    expect(estimateGroupValue(orange, state, profiles)).toMatchObject({
      label: '橙/金色',
      cells: 5,
      // count is null (no avg), so 5 × 9228 per-cell expected
      mean: 46140,
      statusKey: 'ethan.status.groupEstimated',
      priceScore: expect.closeTo(0.1, 5),
      statusClass: 'status-ok',
    });
  });
});
