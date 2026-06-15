import {
  DEFAULT_GROUP_CELL_VALUES,
  DEFAULT_RED_CELL_VALUES,
  GROUPS,
  MAX_RESULTS_PER_RED_COUNT,
  buildGroupReachable,
  buildReachableSums,
  calculateCombinations as calculateCombinationsCore,
  canResolveRow as canResolveRowCore,
  compareItemNames,
  compareItemsByPrice,
  getDetailForRow as getDetailForRowCore,
  getExpectedItemPrice as getExpectedItemPriceCore,
  getExpectedPriceForSelectedItem as getExpectedPriceForSelectedItemCore,
  getExpectedTotal as getExpectedTotalCore,
  getGroupExpectedTotal as getGroupExpectedTotalCore,
  getKnownConstraintSummary as getKnownConstraintSummaryCore,
  getNonRedTargetCells as getNonRedTargetCellsCore,
  getPossibleCounts as getPossibleCountsCore,
  getRedExpectedTotal as getRedExpectedTotalCore,
  getRedTargetCells as getRedTargetCellsCore,
  getTargetInteger,
  hasKnownConstraints,
  matchesKnownConstraints,
  matchesPriceConstraints as matchesPriceConstraintsCore,
  matchesTotalCellRange,
  resolveKnownItemsForGroup as resolveKnownItemsForGroupCore,
  resolveRedTargetCells,
  resolveSelectedItems as resolveSelectedItemsCore,
} from '../../public/ahmed/ahmed-core.js';

function cloneKnownConstraints(knownConstraints = []) {
  return knownConstraints.map((constraint) => ({ ...constraint }));
}

export function createAhmedWorkerContext(snapshot = {}) {
  const {
    groupCellValues = DEFAULT_GROUP_CELL_VALUES,
    redCellValues = DEFAULT_RED_CELL_VALUES,
    itemsByGroup = null,
    allItems = [],
    redStatsBySize = [],
    averagePriceByQualitySize = null,
    knownConstraints = [],
    averages = null,
    groupTargets = null,
    priceAverages = null,
    totalPrices = null,
    totalCells = null,
  } = snapshot;

  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const workerKnownConstraints = cloneKnownConstraints(knownConstraints);
  const groupPriceFeasibilityCache = new Map();

  function getKnownConstraintContext() {
    return {
      itemsByGroup,
      knownConstraints: workerKnownConstraints,
      itemById,
      allItems,
    };
  }

  function getGroupTarget(groupKey, count) {
    if (count === 0) return 0;
    const target = groupTargets?.[groupKey];
    if (target !== null && target !== undefined) return target;
    const avg = averages?.[groupKey];
    return avg ? getTargetInteger(avg, count) : null;
  }

  function getNonRedTargetCellsForRow(row) {
    return getNonRedTargetCellsCore(row, { getGroupTarget });
  }

  function getRedTargetCellsForRow(row) {
    return getRedTargetCellsCore(row, totalCells, { getNonRedTargetCellsForRow });
  }

  function resolveKnownItemsForGroup(groupKey) {
    return resolveKnownItemsForGroupCore(groupKey, getKnownConstraintContext());
  }

  function getRedExpectedItemPrice(item) {
    const stat = redStatsBySize.find((entry) => entry.sizeKey === item.sizeKey);
    return stat ? stat.expectedPrice : null;
  }

  function getExpectedItemPriceForGroup(groupKey, item) {
    return getExpectedItemPriceCore(groupKey, item, { averagePriceByQualitySize });
  }

  function getExpectedPriceForSelectedItemForGroup(groupKey, item, exactIds) {
    return getExpectedPriceForSelectedItemCore(groupKey, item, exactIds, {
      getRedExpectedItemPrice,
      getExpectedItemPriceForGroup,
    });
  }

  function compareItemsByExpected(groupKey) {
    return (a, b) => {
      const aExpected = getExpectedPriceForSelectedItemForGroup(groupKey, a, new Set());
      const bExpected = getExpectedPriceForSelectedItemForGroup(groupKey, b, new Set());

      if (aExpected === null && bExpected !== null) return 1;
      if (aExpected !== null && bExpected === null) return -1;
      if (aExpected !== null && bExpected !== null && aExpected !== bExpected) {
        return aExpected - bExpected;
      }

      return compareItemsByPrice(a, b);
    };
  }

  function resolveSelectedItemsForGroup(groupKey, count, targetCells = null) {
    return resolveSelectedItemsCore(groupKey, {
      ...getKnownConstraintContext(),
      count,
      targetCells,
      compareRemainingItems: compareItemsByExpected(groupKey),
    });
  }

  function canResolveGroupPriceTarget(groupKey, count, targetCells, totalPrice) {
    if (targetCells === null || totalPrice === null) return false;
    if (!itemsByGroup?.[groupKey]) return true;
    const selection = resolveSelectedItemsForGroup(groupKey, count, targetCells);
    if (!selection) return false;

    const cacheKey = [
      groupKey,
      count,
      targetCells,
      totalPrice,
      selection.items.map((item) => item.id).sort().join(','),
      [...selection.exactIds].sort().join(','),
    ].join('|');
    if (groupPriceFeasibilityCache.has(cacheKey)) {
      return groupPriceFeasibilityCache.get(cacheKey);
    }

    let calculatedTotal = 0;
    for (const item of selection.items) {
      const expectedPrice = getExpectedPriceForSelectedItemForGroup(groupKey, item, selection.exactIds);
      if (expectedPrice === null) {
        groupPriceFeasibilityCache.set(cacheKey, false);
        return false;
      }
      calculatedTotal += expectedPrice;
    }

    const result = Math.round(calculatedTotal) === totalPrice;
    groupPriceFeasibilityCache.set(cacheKey, result);
    return result;
  }

  function getGroupExpectedTotalForGroup(groupKey, count) {
    const priceAverage = priceAverages?.[groupKey];
    const totalPriceInput = totalPrices?.[groupKey] ?? null;
    const target = getGroupTarget(groupKey, count);
    return getGroupExpectedTotalCore({
      groupKey,
      count,
      target,
      priceAverage,
      totalPriceInput,
      resolveSelectedItemsForGroup,
      getExpectedPriceForSelectedItemForGroup,
      canResolveGroupPriceTarget,
    });
  }

  function getRedExpectedTotalForRow(redCount, targetCells = null) {
    return getRedExpectedTotalCore({
      redCount,
      targetCells,
      resolveSelectedItemsForGroup,
      getExpectedPriceForSelectedItemForGroup,
    });
  }

  function getExpectedTotalForRow(row) {
    if (!itemsByGroup || !averages) return null;
    return getExpectedTotalCore(row, { getGroupExpectedTotalForGroup });
  }

  function matchesPriceConstraintsForRow(row) {
    return matchesPriceConstraintsCore(row, {
      priceAverages,
      totalPrices,
      getGroupExpectedTotalForGroup,
    });
  }

  function getPossibleCountsForGroup(groupKey, targetCount = null, targetCells = null, totalCount = 0) {
    const group = GROUPS.find((entry) => entry.key === groupKey);
    if (!group) return [];
    groupPriceFeasibilityCache.clear();
    return getPossibleCountsCore({
      group,
      avg: averages?.[groupKey] ?? null,
      targetCount,
      totalCells: targetCells,
      priceAverage: priceAverages?.[groupKey] ?? null,
      totalPrice: totalPrices?.[groupKey] ?? null,
      totalCount,
      groupCellValues,
      canResolveGroupPriceTarget,
    });
  }

  function canResolveRowForRow(row) {
    return canResolveRowCore(row, {
      itemsByGroup,
      getGroupTarget,
      getRedTargetCellsForRow,
      resolveSelectedItemsForGroup,
    });
  }

  function getKnownConstraintSummary() {
    return getKnownConstraintSummaryCore(getKnownConstraintContext());
  }

  function getDetailForRow(row) {
    if (!itemsByGroup) return null;
    return getDetailForRowCore(row, {
      getGroupTarget,
      getRedTargetCells: getRedTargetCellsForRow,
      resolveSelectedItemsForGroup,
      getExpectedPriceForSelectedItemForGroup,
      getGroupExpectedTotalForGroup,
      getRedExpectedTotalForGroup: getRedExpectedTotalForRow,
    });
  }

  return {
    allItems,
    averages,
    canResolveRowForRow,
    getDetailForRow,
    getExpectedTotalForRow,
    getGroupTarget,
    getKnownConstraintSummary,
    getNonRedTargetCellsForRow,
    getPossibleCountsForGroup,
    getRedExpectedTotalForRow,
    getRedTargetCellsForRow,
    groupCellValues,
    itemsByGroup,
    matchesPriceConstraintsForRow,
    redCellValues,
    resolveKnownItemsForGroup,
    resolveSelectedItemsForGroup,
    totalCells,
  };
}

export async function streamAhmedCombinations({
  totalCount,
  possible,
  limit,
  redCount,
  totalCells,
  redAverage,
  totalCellRange = { min: null, max: null },
  knownSummary,
  context,
  maxResultsPerRedCount = MAX_RESULTS_PER_RED_COUNT,
  rowChunkSize = 10,
  iterationYieldInterval = 200,
  onRows = async () => {},
  onProgress = async () => {},
  shouldCancel = () => false,
} = {}) {
  if (knownSummary.invalid) {
    return { results: [], totalMatches: 0, stoppedEarly: false, cancelled: false };
  }

  const sorted = Object.fromEntries(Object.entries(possible).map(([key, counts]) => [
    key,
    [...counts].sort((a, b) => a - b),
  ]));
  const wgCounts = new Set(sorted.wg ?? []);
  const results = [];
  let rowChunk = [];
  let totalMatches = 0;
  let iterations = 0;
  const redStart = redCount === null ? 0 : redCount;
  const redEnd = redCount === null ? totalCount : redCount;
  const constrainedByKnown = hasKnownConstraints(knownSummary);
  const groupReachable = constrainedByKnown
    ? buildGroupReachable(totalCount, { groups: GROUPS, groupCellValues: context.groupCellValues })
    : null;
  const needsRedReachable =
    totalCells !== null ||
    redAverage ||
    totalCellRange.min !== null ||
    totalCellRange.max !== null ||
    knownSummary.red.count > 0;
  const redReachable = needsRedReachable ? buildReachableSums(context.redCellValues, totalCount) : null;

  async function maybeYield() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function flushRows() {
    if (!rowChunk.length) return;
    const rows = rowChunk;
    rowChunk = [];
    await onRows({
      rows,
      totalMatches,
    });
  }

  for (let red = redStart; red <= redEnd; red += 1) {
    if (shouldCancel()) {
      return { results, totalMatches, stoppedEarly: false, cancelled: true };
    }
    if (red < 0 || red > totalCount) continue;
    let resultsForRed = 0;
    const afterRed = totalCount - red;

    for (const orange of sorted.orange ?? []) {
      const afterOrange = afterRed - orange;
      if (afterOrange < 0) break;

      for (const purple of sorted.purple ?? []) {
        const afterPurple = afterOrange - purple;
        if (afterPurple < 0) break;

        for (const blue of sorted.blue ?? []) {
          iterations += 1;
          if (iterations % iterationYieldInterval === 0) {
            await flushRows();
            await onProgress({
              red,
              redEnd,
              totalMatches,
              rows: results.length,
            });
            await maybeYield();
            if (shouldCancel()) {
              return { results, totalMatches, stoppedEarly: false, cancelled: true };
            }
          }

          const wg = afterPurple - blue;
          if (wg < 0) break;
          if (!wgCounts.has(wg)) continue;

          const baseRow = { wg, blue, purple, orange, red };
          const redTargetCells = resolveRedTargetCells(baseRow, {
            totalCells,
            redAverage,
            getRedTargetCellsForRow: context.getRedTargetCellsForRow,
          });
          if ((totalCells !== null || redAverage) && (redTargetCells === null || redTargetCells < 0 || !redReachable[red]?.has(redTargetCells))) {
            continue;
          }
          if (constrainedByKnown && !matchesKnownConstraints(baseRow, redTargetCells, {
            summary: knownSummary,
            groupReachable,
            redReachable,
            groups: GROUPS,
            getGroupTarget: context.getGroupTarget,
          })) {
            continue;
          }
          if (!matchesTotalCellRange(baseRow, redTargetCells, {
            totalCellRange,
            redReachable,
            knownSummary,
            getNonRedTargetCellsForRow: context.getNonRedTargetCellsForRow,
          })) {
            continue;
          }

          const row = { ...baseRow, redTargetCells, expectedTotal: null, redExpectedTotal: null };
          if (constrainedByKnown && !context.canResolveRowForRow(row)) continue;
          if (!context.matchesPriceConstraintsForRow(row)) continue;

          totalMatches += 1;
          if (resultsForRed >= maxResultsPerRedCount) continue;
          row.redExpectedTotal = context.getRedExpectedTotalForRow(red, redTargetCells);
          row.expectedTotal = context.getExpectedTotalForRow(row);
          results.push(row);
          rowChunk.push(row);
          resultsForRed += 1;

          if (rowChunk.length >= rowChunkSize) {
            await flushRows();
            await maybeYield();
            if (shouldCancel()) {
              return { results, totalMatches, stoppedEarly: false, cancelled: true };
            }
          }

          if (results.length >= limit) {
            await flushRows();
            return { results, totalMatches, stoppedEarly: true, cancelled: false };
          }
        }
      }
    }

    await onProgress({
      red,
      redEnd,
      totalMatches,
      rows: results.length,
    });
  }

  await flushRows();
  return { results, totalMatches, stoppedEarly: false, cancelled: false };
}

export function calculateAhmedCombinations(payload = {}) {
  return calculateCombinationsCore(payload);
}

export function formatAhmedKnownSummary(snapshot = {}) {
  return createAhmedWorkerContext(snapshot).getKnownConstraintSummary();
}

export function getAhmedDetail(row, snapshot = {}) {
  return createAhmedWorkerContext(snapshot).getDetailForRow(row);
}

export function sortAhmedItemsByName(items = []) {
  return [...items].sort(compareItemNames);
}
