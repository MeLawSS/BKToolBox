export const GROUPS = [
  { key: 'wg', label: '白+绿', qualities: ['白', '绿'], inputId: 'avg-wg', countInputId: 'count-wg', totalCellsInputId: 'total-cells-wg', priceAverageInputId: 'avg-price-wg', totalPriceInputId: 'total-price-wg', priceMultiplier: 0.8 },
  { key: 'blue', label: '蓝', qualities: ['蓝'], inputId: 'avg-blue', countInputId: 'count-blue', totalCellsInputId: 'total-cells-blue', priceAverageInputId: 'avg-price-blue', totalPriceInputId: 'total-price-blue', priceMultiplier: 0.9 },
  { key: 'purple', label: '紫', qualities: ['紫'], inputId: 'avg-purple', countInputId: 'count-purple', totalCellsInputId: 'total-cells-purple', priceAverageInputId: 'avg-price-purple', totalPriceInputId: 'total-price-purple', priceMultiplier: 0.88 },
  { key: 'orange', label: '橙/金', qualities: ['金'], inputId: 'avg-orange', countInputId: 'count-orange', totalCellsInputId: 'total-cells-orange', priceAverageInputId: 'avg-price-orange', totalPriceInputId: 'total-price-orange', priceMultiplier: 0.95 },
];

export const DEFAULT_GROUP_CELL_VALUES = {
  wg: [1, 2, 3, 4, 5, 6, 8, 9, 12],
  blue: [1, 2, 3, 4, 5, 6, 8, 9, 15, 16, 20],
  purple: [1, 2, 3, 4, 5, 6, 8, 9, 10, 12],
  orange: [1, 2, 3, 4, 6, 8, 9, 10, 12, 15, 16, 18],
};

export const DEFAULT_RED_CELL_VALUES = [1, 2, 3, 4, 6, 8, 9, 10, 12, 15, 16];

export const PRIORITY_KEYS = ['red', 'orange', 'purple', 'blue', 'wg'];
export const AVG_CELL_TOLERANCE = 0.01;
export const MAX_RESULTS_PER_RED_COUNT = 25;

const PINYIN_INITIAL_BOUNDARIES = '阿八嚓哒妸发旮哈讥咔垃妈拿噢啪期然撒塌挖昔压匝';
const PINYIN_INITIALS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
const PINYIN_INITIAL_OVERRIDES = {
  西: 'x',
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function gcd(a, b) {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return Math.abs(a);
}

export function parseAverageValue(raw, label = '数值') {
  const valueText = String(raw).trim();
  if (!valueText) return null;
  if (!/^\d+(?:\.\d+)?$/.test(valueText)) {
    throw new Error(`${label} 不是有效数字`);
  }

  const [integer, decimal = ''] = valueText.split('.');
  const denominator = 10 ** decimal.length;
  const numerator = Number(integer) * denominator + Number(decimal || 0);
  const divisor = gcd(numerator, denominator);

  return {
    raw: valueText,
    numerator: numerator / divisor,
    denominator: denominator / divisor,
    value: numerator / denominator,
  };
}

export function parsePositiveIntegerValue(raw, name) {
  const valueText = String(raw).trim();
  if (!/^\d+$/.test(valueText)) throw new Error(`${name} 必须是整数`);
  return Number(valueText);
}

export function parseOptionalIntegerValue(raw, label) {
  const valueText = String(raw).trim();
  if (!valueText) return null;
  if (!/^\d+$/.test(valueText)) {
    throw new Error(`${label} 必须是整数`);
  }
  return Number(valueText);
}

export function parseRequiredPositiveIntegerValue(raw, label) {
  const valueText = String(raw).trim();
  if (!/^\d+$/.test(valueText) || Number(valueText) <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return Number(valueText);
}

export function getTargetInteger(avg, count) {
  if (count === 0) return avg.value === 0 ? 0 : null;

  const raw = avg.value * count;
  const rounded = Math.round(raw);
  const tolerance = count * AVG_CELL_TOLERANCE;

  if (Math.abs(raw - rounded) > tolerance) return null;
  return rounded;
}

export function getNearestTargetInteger(avg, count, preferredTotal) {
  if (!avg) return preferredTotal;
  if (preferredTotal === null) return getTargetInteger(avg, count);
  if (count === 0) return avg.value === 0 ? 0 : null;

  const rawCount = preferredTotal / avg.value;
  const candidates = new Set();
  const center = Number.isFinite(rawCount) ? rawCount : count;

  for (let offset = -4; offset <= 4; offset += 1) {
    candidates.add(count + offset);
    candidates.add(Math.floor(center) + offset);
    candidates.add(Math.ceil(center) + offset);
  }

  let best = null;
  for (const candidateCount of candidates) {
    if (!Number.isInteger(candidateCount) || candidateCount < 0) continue;
    const target = getTargetInteger(avg, candidateCount);
    if (target === null) continue;

    const distance = Math.abs(target - preferredTotal);
    const countDistance = Math.abs(candidateCount - count);
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && countDistance < best.countDistance) ||
      (distance === best.distance && countDistance === best.countDistance && target < best.target)
    ) {
      best = { target, distance, countDistance };
    }
  }

  return best ? best.target : null;
}

export function makeAverageFromTotalCells(count, totalCells) {
  if (count === 0) {
    if (totalCells !== 0) return null;
    return { raw: '0', numerator: 0, denominator: 1, value: 0 };
  }

  const divisor = gcd(totalCells, count);
  return {
    raw: `${totalCells}/${count}`,
    numerator: totalCells / divisor,
    denominator: count / divisor,
    value: totalCells / count,
  };
}

export function resolveTotalCells(avg, totalCount, totalCells) {
  if (!avg) return totalCells;

  const target = totalCells === null
    ? getTargetInteger(avg, totalCount)
    : getNearestTargetInteger(avg, totalCount, totalCells);
  if (target === null) throw new Error('藏品平均格数无法对应到整数总格数');

  return target;
}

export function parseTotalCellRangeValues(min, max) {
  if (min !== null && max !== null && min > max) {
    throw new Error('所有藏品最小格数不能大于最大格数');
  }

  return { min, max };
}

export function getGroupKeyForQuality(quality) {
  if (quality === '白' || quality === '绿') return 'wg';
  if (quality === '蓝') return 'blue';
  if (quality === '紫') return 'purple';
  if (quality === '金') return 'orange';
  if (quality === '红') return 'red';
  return null;
}

export function makeSizeKey(width, height) {
  return `${width}x${height}`;
}

export function getPinyinInitial(char) {
  if (!/[\u4e00-\u9fff]/.test(char)) return /[a-z0-9]/i.test(char) ? char.toLowerCase() : '';
  if (PINYIN_INITIAL_OVERRIDES[char]) return PINYIN_INITIAL_OVERRIDES[char];

  for (let i = PINYIN_INITIAL_BOUNDARIES.length - 1; i >= 0; i -= 1) {
    if (char.localeCompare(PINYIN_INITIAL_BOUNDARIES[i], 'zh-Hans-CN') >= 0) {
      return PINYIN_INITIALS[i].toLowerCase();
    }
  }

  return '';
}

export function getPinyinInitials(text) {
  return [...text].map(getPinyinInitial).join('');
}

export function getGroupPriceTarget(priceAverage, count, totalPrice) {
  const fromAverage = priceAverage ? getTargetInteger(priceAverage, count) : null;
  if (priceAverage && fromAverage === null) return null;
  if (count === 0) {
    if (totalPrice !== null && totalPrice !== 0) return null;
    return 0;
  }
  if (fromAverage !== null && totalPrice !== null && fromAverage !== totalPrice) return null;
  return totalPrice ?? fromAverage;
}

export function hasGroupPriceConstraint(priceAverage, totalPrice) {
  return Boolean(priceAverage) || totalPrice !== null;
}

export function resolveGroupTarget(avg, count, totalCells) {
  const fromAverage = avg
    ? (totalCells === null ? getTargetInteger(avg, count) : getNearestTargetInteger(avg, count, totalCells))
    : null;
  if (avg && fromAverage === null) return null;
  return fromAverage ?? totalCells;
}

export function buildReachableSums(cells, totalCount) {
  const reachable = [new Set([0])];
  let possible = new Set([0]);

  for (let count = 1; count <= totalCount; count += 1) {
    const next = new Set();
    for (const sum of possible) {
      for (const cell of cells) {
        next.add(sum + cell);
      }
    }
    possible = next;
    reachable[count] = possible;
  }

  return reachable;
}

export function getPossibleCounts({
  group,
  avg,
  targetCount,
  totalCells,
  priceAverage,
  totalPrice,
  totalCount,
  groupCellValues = DEFAULT_GROUP_CELL_VALUES,
  canResolveGroupPriceTarget = () => true,
}) {
  if (targetCount !== null && targetCount > totalCount) return [];

  if (avg && avg.value === 0) {
    if (targetCount !== null && targetCount !== 0) return [];
    if (totalCells !== null && totalCells !== 0) return [];
    if (hasGroupPriceConstraint(priceAverage, totalPrice) && getGroupPriceTarget(priceAverage, 0, totalPrice) === null) return [];
    return [0];
  }

  const cells = groupCellValues[group.key];
  const minCell = cells[0];
  const maxCell = cells[cells.length - 1];
  const reachable = buildReachableSums(cells, totalCount);
  const counts = [];
  const start = targetCount === null && totalCells === 0 ? 0 : targetCount === null ? 1 : targetCount;
  const end = targetCount === null ? totalCount : targetCount;

  for (let count = start; count <= end; count += 1) {
    const target = resolveGroupTarget(avg, count, totalCells);
    if (target === null) continue;
    if (count === 0) {
      if (target !== 0) continue;
      if (hasGroupPriceConstraint(priceAverage, totalPrice) && getGroupPriceTarget(priceAverage, 0, totalPrice) === null) continue;
      counts.push(count);
      continue;
    }
    if (target < minCell * count || target > maxCell * count) continue;
    if (!reachable[count].has(target)) continue;
    if (hasGroupPriceConstraint(priceAverage, totalPrice)) {
      const priceTarget = getGroupPriceTarget(priceAverage, count, totalPrice);
      if (priceTarget === null) continue;
      if (totalPrice !== null && !priceAverage && !canResolveGroupPriceTarget(group.key, count, target, priceTarget)) continue;
    }
    counts.push(count);
  }

  return counts;
}

export function getNonRedTargetCells(row, {
  groups = GROUPS,
  getGroupTarget,
} = {}) {
  let total = 0;

  for (const group of groups) {
    const target = getGroupTarget(group.key, row[group.key]);
    if (target === null) return null;
    total += target;
  }

  return total;
}

export function getRedTargetCells(row, totalCells, {
  getNonRedTargetCellsForRow,
} = {}) {
  if (totalCells === null) return null;

  const nonRedCells = getNonRedTargetCellsForRow(row);
  if (nonRedCells === null) return null;

  return totalCells - nonRedCells;
}

export function resolveRedTargetCells(row, {
  totalCells,
  redAverage,
  getRedTargetCellsForRow,
} = {}) {
  const fromTotalCells = totalCells === null ? null : getRedTargetCellsForRow(row, totalCells);
  const fromAverage = redAverage ? getTargetInteger(redAverage, row.red) : null;

  if (redAverage && fromAverage === null) return null;
  if (fromTotalCells !== null && fromAverage !== null && fromTotalCells !== fromAverage) return null;

  return fromAverage ?? fromTotalCells;
}

export function buildGroupReachable(totalCount, {
  groups = GROUPS,
  groupCellValues = DEFAULT_GROUP_CELL_VALUES,
} = {}) {
  return Object.fromEntries(groups.map(group => [
    group.key,
    buildReachableSums(groupCellValues[group.key], totalCount),
  ]));
}

export function matchesKnownConstraints(row, redTargetCells, {
  summary,
  groupReachable,
  redReachable,
  groups = GROUPS,
  getGroupTarget,
} = {}) {
  for (const group of groups) {
    const required = summary.groups[group.key];
    if (required.count === 0) continue;
    if (row[group.key] < required.count) return false;

    const target = getGroupTarget(group.key, row[group.key]);
    if (target === null) return false;

    const remainingCount = row[group.key] - required.count;
    const remainingCells = target - required.cells;
    if (remainingCells < 0) return false;
    if (!groupReachable[group.key][remainingCount]?.has(remainingCells)) return false;
  }

  if (summary.red.count > 0) {
    if (row.red < summary.red.count) return false;

    if (redTargetCells !== null) {
      const remainingCount = row.red - summary.red.count;
      const remainingCells = redTargetCells - summary.red.cells;
      if (remainingCells < 0) return false;
      if (!redReachable[remainingCount]?.has(remainingCells)) return false;
    }
  }

  return true;
}

export function matchesTotalCellRange(row, redTargetCells, {
  totalCellRange,
  redReachable,
  knownSummary,
  getNonRedTargetCellsForRow,
} = {}) {
  if (totalCellRange.min === null && totalCellRange.max === null) return true;

  const nonRedCells = getNonRedTargetCellsForRow(row);
  if (nonRedCells === null) return false;

  const min = totalCellRange.min ?? -Infinity;
  const max = totalCellRange.max ?? Infinity;

  if (redTargetCells !== null) {
    const total = nonRedCells + redTargetCells;
    return total >= min && total <= max;
  }

  const requiredRedCount = knownSummary.red.count;
  const requiredRedCells = knownSummary.red.cells;
  if (row.red < requiredRedCount) return false;

  for (const extraRedCells of redReachable[row.red - requiredRedCount] ?? []) {
    const total = nonRedCells + requiredRedCells + extraRedCells;
    if (total >= min && total <= max) return true;
  }

  return false;
}

export function canResolveRow(row, {
  groups = GROUPS,
  itemsByGroup,
  getGroupTarget,
  getRedTargetCellsForRow,
  resolveSelectedItemsForGroup,
} = {}) {
  if (!itemsByGroup) return true;

  for (const group of groups) {
    const target = getGroupTarget(group.key, row[group.key]);
    if (!resolveSelectedItemsForGroup(group.key, row[group.key], target)) return false;
  }

  const redTarget = row.redTargetCells ?? getRedTargetCellsForRow(row);
  return Boolean(resolveSelectedItemsForGroup('red', row.red, redTarget));
}

export function calculateCombinations({
  totalCount,
  possible,
  limit,
  redCount,
  totalCells,
  redAverage,
  totalCellRange = { min: null, max: null },
  knownSummary,
  groups = GROUPS,
  redCellValues = DEFAULT_RED_CELL_VALUES,
  groupCellValues = DEFAULT_GROUP_CELL_VALUES,
  maxResultsPerRedCount = MAX_RESULTS_PER_RED_COUNT,
  getGroupTarget,
  getNonRedTargetCellsForRow,
  getRedTargetCellsForRow,
  canResolveRowForRow,
  matchesPriceConstraintsForRow,
  getRedExpectedTotalForRow,
  getExpectedTotalForRow,
} = {}) {
  if (knownSummary.invalid) return { results: [], totalMatches: 0, stoppedEarly: false };

  const sorted = Object.fromEntries(Object.entries(possible).map(([key, counts]) => [
    key,
    [...counts].sort((a, b) => a - b),
  ]));
  const wgCounts = new Set(sorted.wg);
  const results = [];
  let totalMatches = 0;
  const redStart = redCount === null ? 0 : redCount;
  const redEnd = redCount === null ? totalCount : redCount;
  const constrainedByKnown = hasKnownConstraints(knownSummary);
  const groupReachable = constrainedByKnown ? buildGroupReachable(totalCount, { groups, groupCellValues }) : null;
  const needsRedReachable = totalCells !== null || redAverage || totalCellRange.min !== null || totalCellRange.max !== null || knownSummary.red.count > 0;
  const redReachable = needsRedReachable ? buildReachableSums(redCellValues, totalCount) : null;

  for (let red = redStart; red <= redEnd; red += 1) {
    if (red < 0 || red > totalCount) continue;
    let resultsForRed = 0;
    const afterRed = totalCount - red;

    for (const orange of sorted.orange) {
      const afterOrange = afterRed - orange;
      if (afterOrange < 0) break;

      for (const purple of sorted.purple) {
        const afterPurple = afterOrange - purple;
        if (afterPurple < 0) break;

        for (const blue of sorted.blue) {
          const wg = afterPurple - blue;
          if (wg < 0) break;
          if (!wgCounts.has(wg)) continue;

          const baseRow = { wg, blue, purple, orange, red };
          const redTargetCells = resolveRedTargetCells(baseRow, {
            totalCells,
            redAverage,
            getRedTargetCellsForRow,
          });
          if ((totalCells !== null || redAverage) && (redTargetCells === null || redTargetCells < 0 || !redReachable[red]?.has(redTargetCells))) continue;
          if (constrainedByKnown && !matchesKnownConstraints(baseRow, redTargetCells, { summary: knownSummary, groupReachable, redReachable, groups, getGroupTarget })) continue;
          if (!matchesTotalCellRange(baseRow, redTargetCells, { totalCellRange, redReachable, knownSummary, getNonRedTargetCellsForRow })) continue;

          const row = { ...baseRow, redTargetCells, expectedTotal: null, redExpectedTotal: null };
          if (constrainedByKnown && !canResolveRowForRow(row)) continue;
          if (!matchesPriceConstraintsForRow(row)) continue;

          totalMatches += 1;
          if (resultsForRed >= maxResultsPerRedCount) continue;
          row.redExpectedTotal = getRedExpectedTotalForRow(red, redTargetCells);
          row.expectedTotal = getExpectedTotalForRow(row);
          results.push(row);
          resultsForRed += 1;
          if (results.length >= limit) return { results, totalMatches, stoppedEarly: true };
        }
      }
    }
  }

  return { results, totalMatches, stoppedEarly: false };
}

export function buildPairMap(leftCounts, rightCounts) {
  const map = new Map();

  for (const left of leftCounts) {
    for (const right of rightCounts) {
      const sum = left + right;
      let pairs = map.get(sum);
      if (!pairs) {
        pairs = [];
        map.set(sum, pairs);
      }
      pairs.push([left, right]);
    }
  }

  return map;
}

export function comparePriority(a, b) {
  for (const key of PRIORITY_KEYS) {
    const diff = a[key] - b[key];
    if (diff !== 0) return diff;
  }
  return 0;
}

export function compareItemNames(a, b) {
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

export function compareItemsByPrice(a, b) {
  return a.price - b.price ||
    a.cells - b.cells ||
    compareItemNames(a, b);
}

export function compareItemsByCells(a, b) {
  return a.cells - b.cells ||
    a.price - b.price ||
    compareItemNames(a, b);
}

export function getConstraintSpecKey(quality, sizeKey) {
  return `${quality}|${sizeKey}`;
}

export function sumItemCells(items) {
  return items.reduce((sum, item) => sum + item.cells, 0);
}

export function pickItems(items, count, compareItems = compareItemsByPrice) {
  if (count === 0) return [];
  const sortedItems = [...items].sort(compareItems);
  if (sortedItems.length < count) return null;
  return sortedItems.slice(0, count);
}

export function getConstraintItem(constraint, { itemById = new Map(), allItems = [] } = {}) {
  if (constraint.type !== 'exact') return null;
  if (constraint.itemId && itemById.has(constraint.itemId)) return itemById.get(constraint.itemId);

  return allItems.find(item =>
    item.name === constraint.name &&
    item.quality === constraint.quality &&
    item.sizeKey === constraint.sizeKey &&
    item.price === constraint.price
  ) ?? null;
}

export function resolveKnownItemsForGroup(groupKey, {
  itemsByGroup,
  knownConstraints = [],
  itemById = new Map(),
  allItems = [],
} = {}) {
  const pool = itemsByGroup?.[groupKey];
  if (!pool) return null;

  const exactConstraints = knownConstraints.filter(constraint =>
    constraint.groupKey === groupKey && constraint.type === 'exact'
  );
  const outlineConstraints = knownConstraints.filter(constraint =>
    constraint.groupKey === groupKey && constraint.type === 'outline'
  );

  if (exactConstraints.length === 0 && outlineConstraints.length === 0) {
    return {
      items: [],
      itemIds: new Set(),
      exactIds: new Set(),
      exactItems: [],
      cells: 0,
      exactPrice: 0,
    };
  }

  const exactItems = [];
  const itemIds = new Set();
  const exactIds = new Set();
  const exactCoverage = new Map();
  let exactPrice = 0;

  for (const constraint of exactConstraints) {
    const item = getConstraintItem(constraint, { itemById, allItems });
    if (!item || item.groupKey !== groupKey) return null;

    exactItems.push(item);
    itemIds.add(item.id);
    exactIds.add(item.id);
    exactPrice += item.price;

    const specKey = getConstraintSpecKey(item.quality, item.sizeKey);
    exactCoverage.set(specKey, (exactCoverage.get(specKey) ?? 0) + 1);
  }

  const outlineCounts = new Map();
  for (const constraint of outlineConstraints) {
    const specKey = getConstraintSpecKey(constraint.quality, constraint.sizeKey);
    outlineCounts.set(specKey, (outlineCounts.get(specKey) ?? 0) + 1);
  }

  const outlineItems = [];
  for (const [specKey, requiredCount] of outlineCounts) {
    const [quality, sizeKey] = specKey.split('|');
    const coveredByExact = Math.min(requiredCount, exactCoverage.get(specKey) ?? 0);
    const additionalNeeded = requiredCount - coveredByExact;
    if (additionalNeeded <= 0) continue;

    const candidates = pool
      .filter(item => item.quality === quality && item.sizeKey === sizeKey && !itemIds.has(item.id))
      .sort(compareItemsByPrice);

    if (candidates.length < additionalNeeded) return null;

    for (let index = 0; index < additionalNeeded; index += 1) {
      const item = candidates[index];
      outlineItems.push(item);
      itemIds.add(item.id);
    }
  }

  const items = exactItems.concat(outlineItems);
  return {
    items,
    itemIds,
    exactIds,
    exactItems,
    cells: sumItemCells(items),
    exactPrice,
  };
}

export function resolveSelectedItems(groupKey, {
  count,
  targetCells = null,
  itemsByGroup,
  knownConstraints = [],
  itemById = new Map(),
  allItems = [],
  compareRemainingItems = compareItemsByPrice,
} = {}) {
  const pool = itemsByGroup?.[groupKey];
  if (!pool) return null;

  const known = resolveKnownItemsForGroup(groupKey, {
    itemsByGroup,
    knownConstraints,
    itemById,
    allItems,
  });
  if (!known) return null;
  if (known.items.length > count) return null;
  if (targetCells !== null && known.cells > targetCells) return null;

  const remainingCount = count - known.items.length;
  const remainingPool = pool.filter(item => !known.itemIds.has(item.id));
  if (remainingPool.length < remainingCount) return null;

  let remainingItems = [];
  if (remainingCount > 0) {
    if (targetCells === null) {
      remainingItems = pickItems(remainingPool, remainingCount, compareRemainingItems);
    } else {
      remainingItems = findItemsForTotal(remainingPool, remainingCount, targetCells - known.cells);
    }

    if (!remainingItems) return null;
  } else if (targetCells !== null && known.cells !== targetCells) {
    return null;
  }

  return {
    items: known.items.concat(remainingItems),
    exactIds: known.exactIds,
  };
}

export function getExpectedItemPrice(groupKey, item, {
  averagePriceByQualitySize,
  groups = GROUPS,
} = {}) {
  const averagePrice = averagePriceByQualitySize?.[item.quality]?.[item.sizeKey]?.averagePrice;
  if (averagePrice === undefined) return null;

  const group = groups.find(entry => entry.key === groupKey);
  return averagePrice * (group?.priceMultiplier ?? 1);
}

export function getExpectedPriceForQualitySize(groupKey, quality, sizeKey, {
  averagePriceByQualitySize,
  groups = GROUPS,
} = {}) {
  const averagePrice = averagePriceByQualitySize?.[quality]?.[sizeKey]?.averagePrice;
  if (averagePrice === undefined) return null;

  const group = groups.find(entry => entry.key === groupKey);
  return averagePrice * (group?.priceMultiplier ?? 1);
}

export function getExpectedPriceForSelectedItem(groupKey, item, exactIds, {
  getRedExpectedItemPrice = () => null,
  getExpectedItemPriceForGroup = () => null,
} = {}) {
  if (exactIds.has(item.id)) return item.price;
  return groupKey === 'red'
    ? getRedExpectedItemPrice(item)
    : getExpectedItemPriceForGroup(groupKey, item);
}

export function getSelectionExpectedTotal(groupKey, selection, getExpectedPriceForSelectedItemForGroup) {
  let total = 0;
  for (const item of selection.items) {
    const expectedPrice = getExpectedPriceForSelectedItemForGroup(groupKey, item, selection.exactIds);
    if (expectedPrice === null) return null;
    total += expectedPrice;
  }

  return total;
}

export function getRedExpectedTotal({
  redCount,
  targetCells = null,
  resolveSelectedItemsForGroup,
  getExpectedPriceForSelectedItemForGroup,
} = {}) {
  if (redCount === 0) return 0;

  const selection = resolveSelectedItemsForGroup('red', redCount, targetCells);
  if (!selection) return null;

  return getSelectionExpectedTotal('red', selection, getExpectedPriceForSelectedItemForGroup);
}

export function getGroupExpectedTotal({
  groupKey,
  count,
  target,
  priceAverage = null,
  totalPriceInput = null,
  resolveSelectedItemsForGroup,
  getExpectedPriceForSelectedItemForGroup,
  canResolveGroupPriceTarget = () => true,
} = {}) {
  const selection = resolveSelectedItemsForGroup(groupKey, count, target);
  if (!selection) return null;

  if (priceAverage || totalPriceInput !== null) {
    const totalPrice = getGroupPriceTarget(priceAverage, count, totalPriceInput);
    const exactPrice = selection.items
      .filter(item => selection.exactIds.has(item.id))
      .reduce((sum, item) => sum + item.price, 0);
    if (totalPrice === null || exactPrice > totalPrice) return null;
    if (totalPriceInput !== null && !priceAverage && !canResolveGroupPriceTarget(groupKey, count, target, totalPrice)) return null;
    return totalPrice;
  }

  return getSelectionExpectedTotal(groupKey, selection, getExpectedPriceForSelectedItemForGroup);
}

export function getExpectedTotal(row, {
  groups = GROUPS,
  getGroupExpectedTotalForGroup,
} = {}) {
  let total = 0;

  for (const group of groups) {
    const groupTotal = getGroupExpectedTotalForGroup(group.key, row[group.key]);
    if (groupTotal === null) return null;
    total += groupTotal;
  }

  return total;
}

export function matchesPriceConstraints(row, {
  groups = GROUPS,
  priceAverages = {},
  totalPrices = {},
  getGroupExpectedTotalForGroup,
} = {}) {
  for (const group of groups) {
    const hasPriceConstraint =
      priceAverages?.[group.key] ||
      totalPrices?.[group.key] !== null;
    if (!hasPriceConstraint) continue;
    if (getGroupExpectedTotalForGroup(group.key, row[group.key]) === null) return false;
  }

  return true;
}

export function getDetailForRow(row, {
  groups = GROUPS,
  getGroupTarget,
  getRedTargetCells,
  resolveSelectedItemsForGroup,
  getExpectedPriceForSelectedItemForGroup,
  getGroupExpectedTotalForGroup,
  getRedExpectedTotalForGroup,
} = {}) {
  const sections = [];
  let totalPrice = 0;
  let totalCells = 0;

  for (const group of groups) {
    const count = row[group.key];
    const target = getGroupTarget(group.key, count);
    const selection = resolveSelectedItemsForGroup(group.key, count, target);
    if (!selection) return null;

    const itemsWithExpected = selection.items.map(item => ({
      ...item,
      expectedPrice: getExpectedPriceForSelectedItemForGroup(group.key, item, selection.exactIds),
    }));
    const price = itemsWithExpected.reduce((sum, item) => sum + item.price, 0);
    const cells = selection.items.reduce((sum, item) => sum + item.cells, 0);
    const expectedPrice = getGroupExpectedTotalForGroup(group.key, count);
    totalPrice += price;
    totalCells += cells;
    sections.push({ label: group.label, count, target, items: itemsWithExpected, price, cells, expectedPrice });
  }

  const redTarget = row.redTargetCells ?? getRedTargetCells(row);
  const redSelection = resolveSelectedItemsForGroup('red', row.red, redTarget);
  if (!redSelection) return null;

  const redItems = redSelection.items.map(item => ({
    ...item,
    expectedPrice: getExpectedPriceForSelectedItemForGroup('red', item, redSelection.exactIds),
  }));
  const redPrice = redItems.reduce((sum, item) => sum + item.price, 0);
  const redCells = redItems.reduce((sum, item) => sum + item.cells, 0);
  totalPrice += redPrice;
  totalCells += redCells;
  sections.push({
    label: '红',
    count: row.red,
    target: redTarget,
    items: redItems,
    price: redPrice,
    cells: redCells,
    expectedPrice: getRedExpectedTotalForGroup(row.red, redTarget),
  });

  return { sections, totalPrice, totalCells };
}

export function buildRawKnownConstraintSummary(knownConstraints = [], groups = GROUPS) {
  const summary = {
    groups: Object.fromEntries(groups.map(group => [group.key, { count: 0, cells: 0, exactCount: 0, exactPrice: 0 }])),
    red: { count: 0, cells: 0, exactCount: 0, exactPrice: 0 },
  };

  for (const constraint of knownConstraints) {
    const target = constraint.groupKey === 'red' ? summary.red : summary.groups[constraint.groupKey];
    if (!target) continue;
    target.count += 1;
    target.cells += constraint.cells;
    if (constraint.type === 'exact') {
      target.exactCount += 1;
      target.exactPrice += constraint.price;
    }
  }

  return summary;
}

export function getKnownConstraintSummary({
  knownConstraints = [],
  itemsByGroup = null,
  itemById = new Map(),
  allItems = [],
  groups = GROUPS,
} = {}) {
  const summary = buildRawKnownConstraintSummary(knownConstraints, groups);
  summary.invalid = false;

  if (!itemsByGroup) return summary;

  for (const groupKey of [...groups.map(group => group.key), 'red']) {
    const hasConstraints = knownConstraints.some(constraint => constraint.groupKey === groupKey);
    if (!hasConstraints) continue;

    const resolved = resolveKnownItemsForGroup(groupKey, {
      itemsByGroup,
      knownConstraints,
      itemById,
      allItems,
    });
    if (!resolved) {
      summary.invalid = true;
      continue;
    }

    const target = groupKey === 'red' ? summary.red : summary.groups[groupKey];
    target.count = resolved.items.length;
    target.cells = resolved.cells;
    target.exactCount = resolved.exactItems.length;
    target.exactPrice = resolved.exactPrice;
  }

  return summary;
}

export function hasKnownConstraints(summary) {
  return summary.red.count > 0 || Object.values(summary.groups).some(entry => entry.count > 0);
}

export function findItemsForTotal(items, count, total) {
  if (count === 0) return total === 0 ? [] : null;

  const sortedItems = [...items].sort(compareItemsByCells);
  if (sortedItems.length < count) return null;

  const prefixCells = [0];
  for (const item of sortedItems) {
    prefixCells.push(prefixCells[prefixCells.length - 1] + item.cells);
  }

  function getMinRemaining(start, left) {
    if (sortedItems.length - start < left) return Number.POSITIVE_INFINITY;
    return prefixCells[start + left] - prefixCells[start];
  }

  function getMaxRemaining(start, left) {
    if (sortedItems.length - start < left) return Number.NEGATIVE_INFINITY;
    return prefixCells[sortedItems.length] - prefixCells[sortedItems.length - left];
  }

  const memo = new Set();

  function search(start, left, remaining, picked) {
    if (left === 0) return remaining === 0 ? picked : null;
    if (sortedItems.length - start < left) return null;
    if (remaining < getMinRemaining(start, left) || remaining > getMaxRemaining(start, left)) return null;

    const key = `${start}:${left}:${remaining}`;
    if (memo.has(key)) return null;

    for (let i = start; i <= sortedItems.length - left; i += 1) {
      const item = sortedItems[i];
      const nextRemaining = remaining - item.cells;

      if (left === 1) {
        if (nextRemaining === 0) return picked.concat(item);
        continue;
      }

      if (nextRemaining < getMinRemaining(i + 1, left - 1)) break;
      if (nextRemaining > getMaxRemaining(i + 1, left - 1)) continue;

      const result = search(i + 1, left - 1, nextRemaining, picked.concat(item));
      if (result) return result;
    }

    memo.add(key);
    return null;
  }

  return search(0, count, total, []);
}

export function getRedExpectedPrice(sortedItems) {
  const belowLimit = sortedItems.filter(item => item.price < 500000);
  if (belowLimit.length > 1) {
    const total = belowLimit.reduce((sum, item) => sum + item.price, 0);
    const discountedAverage = (total / belowLimit.length) * 0.8;
    return Math.max(discountedAverage, belowLimit[0].price);
  }

  return sortedItems[0].price;
}

export function buildRedStats(items) {
  const groups = new Map();

  for (const item of items) {
    if (!groups.has(item.sizeKey)) groups.set(item.sizeKey, []);
    groups.get(item.sizeKey).push(item);
  }

  return [...groups.entries()].map(([sizeKey, sizeItems]) => {
    const sorted = [...sizeItems].sort((a, b) =>
      a.price - b.price ||
      a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
    const medianIndex = Math.floor((sorted.length - 1) / 2);

    return {
      sizeKey,
      cells: sorted[0].cells,
      count: sorted.length,
      min: sorted[0],
      median: sorted[medianIndex],
      max: sorted[sorted.length - 1],
      expectedPrice: getRedExpectedPrice(sorted),
    };
  }).sort((a, b) =>
    a.cells - b.cells ||
    a.sizeKey.localeCompare(b.sizeKey)
  );
}

export function formatMoney(value) {
  return value.toLocaleString('zh-CN');
}

export function getKnownConstraintLabel(constraint) {
  if (constraint.type === 'exact') {
    return `精确：${constraint.name} · ${constraint.quality} · ${constraint.sizeKey}`;
  }

  const qualityLabel = constraint.quality === '金' ? '橙/金' : constraint.quality;
  return `轮廓：${qualityLabel} · ${constraint.sizeKey}`;
}
