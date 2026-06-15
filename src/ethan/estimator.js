import { ethanProfile } from '../hero-estimator/hero-profiles.js';

export const PER_CELL_EXPECTED = {
  ...ethanProfile.perCellExpected,
};

function computeGroupValue(groupKey, group, profile = ethanProfile) {
  const cells = group.cells ?? 0;
  if (cells === 0) return 0;
  if (Number.isFinite(group.valueOverride)) {
    return group.valueOverride;
  }
  if (group.priceAverage !== null && group.count !== null && group.count > 0) {
    return group.priceAverage * group.count;
  }
  return cells * (profile.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0);
}

export const ESTIMATION_GROUPS = [
  ...ethanProfile.groups,
];

// Skill averages are displayed with limited precision, so keep a small margin
// beyond one hundredth per item when mapping an average back to integer cells.
export const AVG_CELL_TOLERANCE = 0.016;
export const TOTAL_CELL_OPTION_MAX_EXCLUSIVE = 300;

export function parseOptionalNumber(raw, label) {
  const value = String(raw).trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${label} 不是有效数字`);
  }
  return Number(value);
}

export function parseOptionalInteger(raw, label) {
  const value = parseOptionalNumber(raw, label);
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    throw new Error(`${label} 必须是整数`);
  }
  return value;
}

export function getRoundedTarget(avg, count) {
  if (count === 0) return avg === 0 ? 0 : null;
  const raw = avg * count;
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) > count * AVG_CELL_TOLERANCE) return null;
  return rounded;
}

export function deriveNearestCellsFromAverage(avg, preferredCells) {
  if (avg === null) return preferredCells;
  if (preferredCells === null) return null;
  if (avg <= 0) return preferredCells === 0 ? 0 : null;

  const estimate = preferredCells / avg;
  const candidates = new Set();
  for (let offset = -4; offset <= 4; offset += 1) {
    candidates.add(Math.floor(estimate) + offset);
    candidates.add(Math.ceil(estimate) + offset);
  }

  let best = null;
  for (const count of candidates) {
    if (!Number.isInteger(count) || count < 0) continue;
    const cells = getRoundedTarget(avg, count);
    if (cells === null) continue;

    const distance = Math.abs(cells - preferredCells);
    if (!best || distance < best.distance || (distance === best.distance && cells < best.cells)) {
      best = { cells, distance };
    }
  }

  return best ? best.cells : null;
}

export function deriveCountFromCells(avg, cells) {
  if (avg === null || cells === null || avg <= 0) return null;
  const estimate = cells / avg;
  const candidates = [
    Math.floor(estimate) - 1,
    Math.floor(estimate),
    Math.ceil(estimate),
    Math.ceil(estimate) + 1,
  ].filter((count) => Number.isInteger(count) && count >= 0);

  for (const count of new Set(candidates)) {
    if (getRoundedTarget(avg, count) === cells) return count;
  }

  return Math.max(0, Math.round(estimate));
}

export function isCellsFeasibleForAverage(avg, cells) {
  const count = deriveCountFromCells(avg, cells);
  return count !== null && count > 0 && getRoundedTarget(avg, count) === cells;
}

export function getFeasibleCellsFromAverage(avg, maxExclusive = TOTAL_CELL_OPTION_MAX_EXCLUSIVE) {
  if (avg === null || avg <= 0 || maxExclusive <= 1) return [];

  const maxCells = Math.ceil(maxExclusive) - 1;
  const candidates = [];
  for (let cells = 1; cells <= maxCells; cells += 1) {
    const count = deriveCountFromCells(avg, cells);
    if (count === null || count <= 0) continue;
    if (getRoundedTarget(avg, count) !== cells) continue;
    candidates.push({ count, cells });
  }

  return candidates;
}

export function getPossibleCellsFromAverage(avg, maxTotalCells) {
  if (avg === null || avg <= 0 || maxTotalCells === null || maxTotalCells <= 0) return [];

  const candidates = [];
  for (let count = 1; count <= maxTotalCells; count += 1) {
    const cells = getRoundedTarget(avg, count);
    if (cells === null || cells <= 0 || cells > maxTotalCells) continue;
    candidates.push({ count, cells });
  }

  const byCells = new Map();
  for (const candidate of candidates) {
    const existing = byCells.get(candidate.cells);
    if (!existing || candidate.count < existing.count) {
      byCells.set(candidate.cells, candidate);
    }
  }

  return [...byCells.values()].sort((a, b) => a.cells - b.cells || a.count - b.count);
}

export function buildPriceProfilesByGroup(data, groups = ESTIMATION_GROUPS) {
  return Object.fromEntries(groups.map((group) => {
    const entries = group.qualities.flatMap((quality) =>
      Object.values(data?.[quality] || {}).map((entry) => ({
        cells: entry.cells,
        averagePrice: entry.averagePrice,
      }))
    ).filter((entry) =>
      Number.isFinite(entry.cells) &&
      entry.cells > 0 &&
      Number.isFinite(entry.averagePrice) &&
      entry.averagePrice > 0
    );

    const byCells = new Map();
    for (const entry of entries) {
      if (!byCells.has(entry.cells)) {
        byCells.set(entry.cells, { cells: entry.cells, totalPrice: 0, count: 0 });
      }
      const bucket = byCells.get(entry.cells);
      bucket.totalPrice += entry.averagePrice;
      bucket.count += 1;
    }

    return [group.key, [...byCells.values()].map((entry) => ({
      cells: entry.cells,
      averagePrice: entry.totalPrice / entry.count,
    })).sort((a, b) => a.cells - b.cells)];
  }));
}

export function estimateAveragePriceForCells(groupKey, cells, priceProfilesByGroup) {
  const profile = priceProfilesByGroup?.[groupKey];
  if (!profile || !profile.length || cells === null || cells <= 0) return null;

  let best = profile[0];
  for (const entry of profile) {
    if (Math.abs(entry.cells - cells) < Math.abs(best.cells - cells)) {
      best = entry;
    }
  }

  return best.averagePrice;
}

export function estimateAveragePriceRangeForCombination(groupKey, candidate, priceProfilesByGroup) {
  const profile = priceProfilesByGroup?.[groupKey];
  const count = candidate?.count;
  const cells = candidate?.cells;
  if (
    !profile ||
    !profile.length ||
    !Number.isInteger(count) ||
    !Number.isInteger(cells) ||
    count <= 0 ||
    cells <= 0 ||
    cells < count
  ) {
    const averagePrice = estimateAveragePriceForCells(groupKey, cells, priceProfilesByGroup);
    return averagePrice === null ? null : { min: averagePrice, max: averagePrice };
  }

  const priceByCells = [...profile]
    .filter((entry) =>
      Number.isInteger(entry.cells) &&
      entry.cells > 0 &&
      Number.isFinite(entry.averagePrice) &&
      entry.averagePrice > 0
    )
    .sort((a, b) => a.cells - b.cells || a.averagePrice - b.averagePrice);

  if (!priceByCells.length) return null;

  const reachable = Array.from({ length: count + 1 }, () => new Set());
  const totals = Array.from({ length: count + 1 }, () => new Map());
  reachable[0].add(0);
  totals[0].set(0, { min: 0, max: 0 });

  for (let used = 1; used <= count; used += 1) {
    for (const previousCells of reachable[used - 1]) {
      const previous = totals[used - 1].get(previousCells);
      for (const entry of priceByCells) {
        const nextCells = previousCells + entry.cells;
        if (nextCells > cells) continue;

        reachable[used].add(nextCells);
        const nextTotalPrice = previous.min + entry.averagePrice;
        const nextMaxTotalPrice = previous.max + entry.averagePrice;
        const current = totals[used].get(nextCells);
        totals[used].set(nextCells, {
          min: current ? Math.min(current.min, nextTotalPrice) : nextTotalPrice,
          max: current ? Math.max(current.max, nextMaxTotalPrice) : nextMaxTotalPrice,
        });
      }
    }
  }

  const range = totals[count].get(cells);
  if (!range) {
    const averagePrice = estimateAveragePriceForCells(groupKey, cells, priceProfilesByGroup);
    return averagePrice === null ? null : { min: averagePrice, max: averagePrice };
  }

  return {
    min: range.min / count,
    max: range.max / count,
  };
}

export function estimateAveragePriceForCombination(groupKey, candidate, priceProfilesByGroup) {
  const range = estimateAveragePriceRangeForCombination(groupKey, candidate, priceProfilesByGroup);
  return range === null ? null : (range.min + range.max) / 2;
}

export function getPriceScore(groupKey, targetAveragePrice, candidate, priceProfilesByGroup) {
  if (targetAveragePrice === null) return 0;

  const estimatedAveragePrice = estimateAveragePriceRangeForCombination(groupKey, candidate, priceProfilesByGroup);
  if (estimatedAveragePrice === null) return Number.POSITIVE_INFINITY;

  if (targetAveragePrice >= estimatedAveragePrice.min && targetAveragePrice <= estimatedAveragePrice.max) {
    return 0;
  }

  const distance = Math.min(
    Math.abs(estimatedAveragePrice.min - targetAveragePrice),
    Math.abs(estimatedAveragePrice.max - targetAveragePrice)
  );
  return distance / Math.max(1, targetAveragePrice);
}

export function floorAverage(total, count) {
  return Math.floor(total / count * 100) / 100;
}

export function findTotalForAveragePrice(avgPrice, count) {
  if (!Number.isFinite(avgPrice) || !Number.isInteger(count) || count <= 0) return null;

  const rawTotal = avgPrice * count;
  const roundedTotal = Math.round(rawTotal);
  const tolerance = count * 0.01;
  if (Math.abs(rawTotal - roundedTotal) <= tolerance + 1e-9) return roundedTotal;
  return null;
}

export function prepareCollectibleItemsForGroup(collectibles, groupKey, groups = ESTIMATION_GROUPS) {
  const group = groups.find((entry) => entry.key === groupKey);
  if (!group || !Array.isArray(collectibles)) return [];

  const qualitySet = new Set(group.qualities);
  return collectibles
    .filter((item) => qualitySet.has(item?.quality))
    .map((item) => ({
      name: item.name,
      price: item.price,
      cells: item.size?.width * item.size?.height,
    }))
    .filter((item) =>
      item.name &&
      Number.isFinite(item.price) &&
      item.price > 0 &&
      Number.isInteger(item.cells) &&
      item.cells > 0
    )
    .sort((a, b) => a.price - b.price || a.cells - b.cells || a.name.localeCompare(b.name, 'zh-CN'));
}

export function hasMatchingAveragePriceCombination(items, candidate, targetAveragePrice) {
  const count = candidate?.count;
  const cells = candidate?.cells;
  const totalPrice = findTotalForAveragePrice(targetAveragePrice, count);
  if (
    totalPrice === null ||
    !Array.isArray(items) ||
    !items.length ||
    !Number.isInteger(cells) ||
    cells <= 0
  ) {
    return false;
  }

  const sortedItems = items
    .filter((item) =>
      Number.isFinite(item.price) &&
      item.price > 0 &&
      Number.isInteger(item.cells) &&
      item.cells > 0
    )
    .sort((a, b) => a.price - b.price || a.cells - b.cells);
  if (!sortedItems.length) return false;

  const minPrice = sortedItems[0].price;
  const maxPrice = sortedItems[sortedItems.length - 1].price;
  const minCells = Math.min(...sortedItems.map((item) => item.cells));
  const maxCells = Math.max(...sortedItems.map((item) => item.cells));
  const failed = new Set();

  function search(startIndex, leftCount, leftCells, leftPrice) {
    if (leftCount === 0) return leftCells === 0 && leftPrice === 0;
    if (leftCells < minCells * leftCount || leftCells > maxCells * leftCount) return false;
    if (leftPrice < minPrice * leftCount || leftPrice > maxPrice * leftCount) return false;

    const key = `${startIndex}|${leftCount}|${leftCells}|${leftPrice}`;
    if (failed.has(key)) return false;

    for (let index = startIndex; index < sortedItems.length; index += 1) {
      const item = sortedItems[index];
      if (item.price * leftCount > leftPrice) break;
      if (item.cells > leftCells || item.price > leftPrice) continue;
      if (search(index, leftCount - 1, leftCells - item.cells, leftPrice - item.price)) {
        return true;
      }
    }

    failed.add(key);
    return false;
  }

  return search(0, count, cells, totalPrice);
}

export function hasMatchingTotalPriceCombination(items, candidate, targetTotalPrice) {
  const count = candidate?.count;
  const cells = candidate?.cells;
  if (
    !Number.isFinite(targetTotalPrice) ||
    targetTotalPrice <= 0 ||
    !Array.isArray(items) ||
    !items.length ||
    !Number.isInteger(count) ||
    count <= 0 ||
    !Number.isInteger(cells) ||
    cells <= 0
  ) {
    return false;
  }

  const sortedItems = items
    .filter((item) =>
      Number.isFinite(item.price) &&
      item.price > 0 &&
      Number.isInteger(item.cells) &&
      item.cells > 0
    )
    .sort((a, b) => a.price - b.price || a.cells - b.cells);
  if (!sortedItems.length) return false;

  const minPrice = sortedItems[0].price;
  const maxPrice = sortedItems[sortedItems.length - 1].price;
  const minCells = Math.min(...sortedItems.map((item) => item.cells));
  const maxCells = Math.max(...sortedItems.map((item) => item.cells));
  const failed = new Set();

  function search(startIndex, leftCount, leftCells, leftPrice) {
    if (leftCount === 0) return leftCells === 0 && leftPrice === 0;
    if (leftCells < minCells * leftCount || leftCells > maxCells * leftCount) return false;
    if (leftPrice < minPrice * leftCount || leftPrice > maxPrice * leftCount) return false;

    const key = `${startIndex}|${leftCount}|${leftCells}|${leftPrice}`;
    if (failed.has(key)) return false;

    for (let index = startIndex; index < sortedItems.length; index += 1) {
      const item = sortedItems[index];
      if (item.price * leftCount > leftPrice) break;
      if (item.cells > leftCells || item.price > leftPrice) continue;
      if (search(index, leftCount - 1, leftCells - item.cells, leftPrice - item.price)) {
        return true;
      }
    }

    failed.add(key);
    return false;
  }

  return search(0, count, cells, targetTotalPrice);
}

export function findMatchingTotalPriceCounts(items, targetCells, targetTotalPrice, maxCount = 30) {
  if (
    !Array.isArray(items) ||
    !items.length ||
    !Number.isInteger(targetCells) ||
    targetCells <= 0 ||
    !Number.isFinite(targetTotalPrice) ||
    targetTotalPrice <= 0
  ) {
    return [];
  }

  const matches = [];
  for (let count = 1; count <= Math.min(maxCount, targetCells); count += 1) {
    if (hasMatchingTotalPriceCombination(items, { count, cells: targetCells }, targetTotalPrice)) {
      matches.push(count);
    }
  }
  return matches;
}

export function findFirstAveragePriceCellMatch(items, targetCells, targetAveragePrice, maxCount = 30) {
  if (
    !Array.isArray(items) ||
    !items.length ||
    !Number.isInteger(targetCells) ||
    targetCells <= 0 ||
    !Number.isFinite(targetAveragePrice) ||
    targetAveragePrice <= 0
  ) {
    return null;
  }

  for (let count = 1; count <= Math.min(maxCount, targetCells); count += 1) {
    const totalPrice = findTotalForAveragePrice(targetAveragePrice, count);
    if (totalPrice === null) continue;
    const candidate = { count, cells: targetCells };
    if (hasMatchingAveragePriceCombination(items, candidate, targetAveragePrice)) {
      return { ...candidate, totalPrice };
    }
  }

  return null;
}

export function parseComboOutputLine(line) {
  const text = String(line ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  const match = text.match(/TotalCells=(\d+),\s*TotalPrice=(\d+),\s*Count=(\d+)/);
  if (!match) return null;

  return {
    cells: Number(match[1]),
    totalPrice: Number(match[2]),
    count: Number(match[3]),
  };
}

export function parsePurpleComboOutputLine(line) {
  return parseComboOutputLine(line);
}

export function filterCandidatesByPrice(groupKey, targetAveragePrice, candidates, priceProfilesByGroup) {
  if (targetAveragePrice === null || candidates.length <= 1) return candidates;

  const scored = candidates.map((candidate) => ({
    ...candidate,
    priceScore: getPriceScore(groupKey, targetAveragePrice, candidate, priceProfilesByGroup),
  })).filter((candidate) => Number.isFinite(candidate.priceScore));

  if (!scored.length) return candidates;

  const bestScore = Math.min(...scored.map((candidate) => candidate.priceScore));
  const tolerance = Math.max(0.18, bestScore + 0.08);
  const filtered = scored
    .filter((candidate) => candidate.priceScore <= tolerance)
    .sort((a, b) =>
      a.priceScore - b.priceScore ||
      a.cells - b.cells ||
      a.count - b.count
    );

  return filtered.length ? filtered : scored.sort((a, b) => a.priceScore - b.priceScore).slice(0, 1);
}

export function collectEstimationInputs(globalInputs, groupInputs, groups = ESTIMATION_GROUPS) {
  const inputTotalCells = parseOptionalInteger(globalInputs.totalCells, '所有藏品总格数');
  const totalAverage = parseOptionalNumber(globalInputs.totalAverage, '所有藏品平均格数');
  const totalCells = inputTotalCells;
  if (
    inputTotalCells !== null &&
    totalAverage !== null &&
    !isCellsFeasibleForAverage(totalAverage, inputTotalCells)
  ) {
    throw new Error('所有藏品平均格数无法对应到可行总格数');
  }

  const stateGroups = Object.fromEntries(groups.map((group) => {
    const input = groupInputs[group.key];
    const avg = parseOptionalNumber(input.avg, `${group.label}平均格数`);
    const inputCells = parseOptionalInteger(input.cells, `${group.label}总格数`);
    const priceAverage = parseOptionalNumber(input.priceAverage, `${group.label}平均价格`);
    const cells = deriveNearestCellsFromAverage(avg, inputCells);
    if (inputCells !== null && avg !== null && cells === null) {
      throw new Error(`${group.label}平均格数无法对应到可行总格数`);
    }

    return [group.key, {
      avg,
      cells,
      priceAverage,
      count: deriveCountFromCells(avg, cells),
    }];
  }));

  const knownCells = groups.reduce((sum, group) => sum + (stateGroups[group.key].cells ?? 0), 0);
  if (totalCells !== null && knownCells > totalCells) {
    throw new Error('各品质总格数之和超过所有藏品总格数');
  }

  return {
    totalCells,
    totalAverage,
    totalCount: deriveCountFromCells(totalAverage, totalCells),
    groups: stateGroups,
    knownCells,
  };
}

export function getFilledGroups(state, groups = ESTIMATION_GROUPS) {
  return groups.filter((group) => state.groups[group.key].cells !== null);
}

export function getStage(state, groups = ESTIMATION_GROUPS) {
  const filled = getFilledGroups(state, groups).map((group) => group.key);
  if (filled.includes('red')) return 'red';
  if (filled.includes('orange')) return 'orange';
  if (filled.includes('purple')) return 'purple';
  if (filled.includes('blue')) return 'blue';
  if (filled.includes('wg')) return 'wg';
  return 'total';
}

export function estimateTotalByStage(state, groups = ESTIMATION_GROUPS, profile = ethanProfile) {
  const stateGroups = state.groups;
  const stage = getStage(state, groups);
  const groupKeys = groups.map((group) => group.key);

  let knownCells = 0;
  let knownValue = 0;
  let monitorContribCells = 0;
  for (const key of groupKeys) {
    const group = stateGroups[key];
    if (!group) continue;
    if (group.cells !== null) {
      knownCells += group.cells;
      knownValue += computeGroupValue(key, group, profile);
    } else if (group.monitorKnownCells > 0) {
      knownCells += group.monitorKnownCells;
      knownValue += group.monitorKnownValue ?? 0;
      monitorContribCells += group.monitorKnownCells;
    }
  }

  if (state.totalCells === null) {
    return {
      stage,
      total: knownValue,
      remaining: 0,
      unitPrice: null,
      message: '未填写总格数，仅按已知品质格数估算',
    };
  }

  const remaining = Math.max(0, state.totalCells - knownCells);
  const lowestMissingKey = groupKeys.find((key) => stateGroups[key]?.cells === null);
  const unitPrice = lowestMissingKey ? (profile.perCellExpected?.[lowestMissingKey] ?? PER_CELL_EXPECTED[lowestMissingKey]) : null;
  const remainingValue = lowestMissingKey ? remaining * unitPrice : 0;
  const total = knownValue + remainingValue;

  let message;
  if (!lowestMissingKey) {
    message = '已知所有品质格数，按各品质单格期望估算';
  } else {
    const knownLabels = groupKeys
      .filter((key) => stateGroups[key]?.cells !== null)
      .map((key) => groups.find((g) => g.key === key)?.label ?? key)
      .join('、');
    const missingLabel = groups.find((g) => g.key === lowestMissingKey)?.label ?? lowestMissingKey;
    const monitorClause = monitorContribCells > 0 ? `，另有矩阵轮廓贡献${monitorContribCells}格` : '';
    message = knownLabels
      ? `已输入${knownLabels}${monitorClause}，剩余${remaining}格按${missingLabel}(${unitPrice}/格)估算`
      : monitorContribCells > 0
        ? `矩阵轮廓贡献${monitorContribCells}格，剩余${remaining}格按${missingLabel}(${unitPrice}/格)估算`
        : `仅输入总格数，${remaining}格按${missingLabel}(${unitPrice}/格)估算`;
  }

  return { stage, total, remaining, unitPrice, message };
}

export function getEffectiveMaxCells(state, profile = ethanProfile) {
  if (state.totalCells === null) return null;
  if (state.totalCount !== null) return state.totalCells;
  const relaxedKeys = profile.overflowRelaxationGroupKeys ?? [];
  if (!relaxedKeys.length) return state.totalCells;
  return relaxedKeys.every((key) => state.groups[key]?.cells !== null)
    ? state.totalCells + (profile.overflowRelaxationBuffer ?? 0)
    : state.totalCells;
}

function getMonitorKnownCells(state, excludedGroupKeys = []) {
  const excluded = new Set(excludedGroupKeys);
  return Object.entries(state.groups)
    .reduce((sum, [key, group]) =>
      sum + (!excluded.has(key) && group.cells === null && group.monitorKnownCells > 0 ? group.monitorKnownCells : 0)
    , 0);
}

export function getAverageOnlyPredictions(state, groupKey, excludedMonitorGroupKeys = [groupKey], profile = ethanProfile) {
  const group = state.groups[groupKey];
  if (!group || state.totalCells === null || group.avg === null || group.cells !== null) return [];

  const effectiveMax = getEffectiveMaxCells(state, profile);
  const monitorKnownTotal = getMonitorKnownCells(state, excludedMonitorGroupKeys);
  const maxGroupCells = effectiveMax - state.knownCells - monitorKnownTotal;
  if (maxGroupCells <= 0) return [];

  const minGroupCells = group.monitorKnownCells > 0 ? group.monitorKnownCells : 0;
  return getPossibleCellsFromAverage(group.avg, maxGroupCells)
    .filter((candidate) => candidate.cells >= minGroupCells);
}

export function getPurpleAverageOnlyPredictions(state) {
  return getAverageOnlyPredictions(state, 'purple');
}

export function cloneStateWithGroupCells(state, groupKey, candidate, groups = ESTIMATION_GROUPS, profile = ethanProfile) {
  const stateGroups = Object.fromEntries(groups.map((group) => [
    group.key,
    { ...state.groups[group.key] },
  ]));
  stateGroups[groupKey].cells = candidate.cells;
  stateGroups[groupKey].count = candidate.count;
  stateGroups[groupKey].priceScore = candidate.priceScore ?? null;

  const src = state.groups[groupKey];
  if (src?.monitorKnownCells > 0 && Number.isFinite(src.monitorKnownValue)) {
    const remaining = Math.max(0, candidate.cells - src.monitorKnownCells);
    const perCellExpected = profile.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0;
    stateGroups[groupKey].valueOverride = src.monitorKnownValue + remaining * perCellExpected;
  }

  return {
    ...state,
    groups: stateGroups,
    knownCells: groups.reduce((sum, group) => sum + (stateGroups[group.key].cells ?? 0), 0),
  };
}

export function cloneStateWithGroupCandidates(state, candidatesByGroup, groups = ESTIMATION_GROUPS, profile = ethanProfile) {
  const stateGroups = Object.fromEntries(groups.map((group) => [
    group.key,
    { ...state.groups[group.key] },
  ]));

  for (const [groupKey, candidate] of Object.entries(candidatesByGroup)) {
    if (!stateGroups[groupKey]) continue;
    stateGroups[groupKey].cells = candidate.cells;
    stateGroups[groupKey].count = candidate.count;
    stateGroups[groupKey].priceScore = candidate.priceScore ?? null;

    const src = state.groups[groupKey];
    if (src?.monitorKnownCells > 0 && Number.isFinite(src.monitorKnownValue)) {
      const remaining = Math.max(0, candidate.cells - src.monitorKnownCells);
      const perCellExpected = profile.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0;
      stateGroups[groupKey].valueOverride = src.monitorKnownValue + remaining * perCellExpected;
    }
  }

  return {
    ...state,
    groups: stateGroups,
    knownCells: groups.reduce((sum, group) => sum + (stateGroups[group.key].cells ?? 0), 0),
  };
}

export function getCombinedAverageOnlyPredictions(state, groupKeys, maxResults = 100, profile = ethanProfile) {
  // When all groups lack total cell input (including monitor-derived cells),
  // skip combined and let callers fall through to individual predictions.
  // The length >= 2 check protects single-config profiles (Elsa).
  if (
    groupKeys.length >= 2
    && groupKeys.every((key) => {
      const g = state.groups[key];
      return g?.cells === null && !(g?.monitorKnownCells > 0);
    })
  ) {
    return [];
  }

  const candidateLists = groupKeys
    .map((groupKey) => ({
      groupKey,
      candidates: getAverageOnlyPredictions(state, groupKey, groupKeys, profile),
    }))
    .filter((entry) => entry.candidates.length > 0);

  if (candidateLists.length < 2) return [];

  const results = [];
  const effectiveMax = getEffectiveMaxCells(state, profile);
  const monitorKnownTotal = getMonitorKnownCells(state, groupKeys);
  const targetCandidateCells = state.totalCount !== null && state.totalCells !== null
    ? Math.max(0, state.totalCells - state.knownCells - monitorKnownTotal)
    : null;

  function search(index, selected) {
    if (index === candidateLists.length) {
      const candidateCells = Object.values(selected)
        .reduce((sum, candidate) => sum + candidate.cells, 0);
      if (effectiveMax !== null && state.knownCells + monitorKnownTotal + candidateCells > effectiveMax) return;

      results.push({
        candidatesByGroup: Object.fromEntries(
          Object.entries(selected).map(([groupKey, candidate]) => [groupKey, { ...candidate }])
        ),
      });
      return;
    }

    const { groupKey, candidates } = candidateLists[index];
    for (const candidate of candidates) {
      selected[groupKey] = candidate;
      const candidateCells = Object.values(selected)
        .reduce((sum, item) => sum + item.cells, 0);
      if (effectiveMax === null || state.knownCells + monitorKnownTotal + candidateCells <= effectiveMax) {
        search(index + 1, selected);
      }
      delete selected[groupKey];
    }
  }

  search(0, {});

  return results.sort((a, b) => {
    const totalCellsA = Object.values(a.candidatesByGroup).reduce((sum, item) => sum + item.cells, 0);
    const totalCellsB = Object.values(b.candidatesByGroup).reduce((sum, item) => sum + item.cells, 0);
    if (targetCandidateCells !== null) {
      const distanceA = Math.abs(totalCellsA - targetCandidateCells);
      const distanceB = Math.abs(totalCellsB - targetCandidateCells);
      if (distanceA !== distanceB) return distanceA - distanceB;
      if (totalCellsA !== totalCellsB) return totalCellsB - totalCellsA;
    }
    if (totalCellsA !== totalCellsB) return totalCellsA - totalCellsB;

    const totalCountA = Object.values(a.candidatesByGroup).reduce((sum, item) => sum + item.count, 0);
    const totalCountB = Object.values(b.candidatesByGroup).reduce((sum, item) => sum + item.count, 0);
    return totalCountA - totalCountB;
  }).slice(0, maxResults);
}

export function estimateGroupValue(group, state, priceProfilesByGroup, profile = ethanProfile) {
  const input = state.groups[group.key];
  const cells = input.cells;
  const count = input.count;
  const avg = cells !== null && count !== null && count > 0 ? cells / count : input.avg;
  const priceScore = input.priceAverage !== null && cells !== null
    ? getPriceScore(group.key, input.priceAverage, { cells, count: input.count }, priceProfilesByGroup)
    : null;

  if (cells === null) {
    return {
      label: group.label,
      labelKey: group.labelKey,
      count,
      cells,
      avg,
      low: 0,
      mean: 0,
      high: 0,
      statusKey: 'ethan.status.groupNotInput',
      priceScore: null,
      statusClass: 'status-ok',
    };
  }

  const mean = computeGroupValue(group.key, input, profile);

  return {
    label: group.label,
    labelKey: group.labelKey,
    count,
    cells,
    avg,
    low: mean,
    mean,
    high: mean,
    statusKey: input.valueSource === 'monitorOutlines'
      ? 'ethan.status.groupOutlineEstimated'
      : 'ethan.status.groupEstimated',
    priceScore: Number.isFinite(priceScore) ? priceScore : null,
    statusClass: 'status-ok',
  };
}
