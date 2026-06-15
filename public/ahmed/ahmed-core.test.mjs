import { describe, expect, it } from 'vitest';
import {
  buildPairMap,
  buildGroupReachable,
  buildRawKnownConstraintSummary,
  buildReachableSums,
  buildRedStats,
  calculateCombinations,
  canResolveRow,
  comparePriority,
  findItemsForTotal,
  formatMoney,
  getDetailForRow,
  getExpectedItemPrice,
  getExpectedPriceForQualitySize,
  getExpectedPriceForSelectedItem,
  getExpectedTotal,
  getConstraintItem,
  getGroupKeyForQuality,
  getGroupExpectedTotal,
  getGroupPriceTarget,
  getNonRedTargetCells,
  getPossibleCounts,
  getKnownConstraintSummary,
  getKnownConstraintLabel,
  getNearestTargetInteger,
  getPinyinInitials,
  getRedTargetCells,
  getRedExpectedTotal,
  hasKnownConstraints,
  matchesKnownConstraints,
  matchesPriceConstraints,
  matchesTotalCellRange,
  makeSizeKey,
  parseAverageValue,
  parseOptionalIntegerValue,
  parsePositiveIntegerValue,
  parseRequiredPositiveIntegerValue,
  parseTotalCellRangeValues,
  pickItems,
  resolveGroupTarget,
  resolveKnownItemsForGroup,
  resolveRedTargetCells,
  resolveSelectedItems,
  resolveTotalCells,
  sumItemCells,
} from './ahmed-core.js';

const avg = value => parseAverageValue(value, '平均值');

describe('Ahmed core helpers', () => {
  it('parses average values and rejects invalid numeric text', () => {
    expect(avg(' 12.50 ')).toMatchObject({
      raw: '12.50',
      numerator: 25,
      denominator: 2,
      value: 12.5,
    });
    expect(parseAverageValue('')).toBeNull();
    expect(() => avg('12.')).toThrow('平均值 不是有效数字');
  });

  it('resolves average targets near the preferred total', () => {
    const average = avg('2.5');

    expect(getGroupPriceTarget(average, 4, null)).toBe(10);
    expect(getGroupPriceTarget(average, 4, 10)).toBe(10);
    expect(getGroupPriceTarget(average, 4, 11)).toBeNull();
    expect(getGroupPriceTarget(null, 0, 1)).toBeNull();
    expect(getNearestTargetInteger(avg('3'), 4, 13)).toBe(12);
    expect(resolveTotalCells(avg('2'), 3, null)).toBe(6);
    expect(resolveTotalCells(avg('2.5'), 4, 11)).toBe(10);
    expect(resolveGroupTarget(avg('3'), 2, null)).toBe(6);
    expect(resolveGroupTarget(avg('3'), 2, 7)).toBe(6);
    expect(resolveGroupTarget(avg('2.4'), 1, null)).toBeNull();
    expect(() => resolveTotalCells(avg('2.4'), 1, null)).toThrow('藏品平均格数无法对应到整数总格数');
  });

  it('parses integer inputs and validates total cell ranges', () => {
    expect(parsePositiveIntegerValue(' 0 ', '藏品总件数')).toBe(0);
    expect(parseOptionalIntegerValue(' ', '总格数')).toBeNull();
    expect(parseOptionalIntegerValue('12', '总格数')).toBe(12);
    expect(parseRequiredPositiveIntegerValue('5', '宽')).toBe(5);
    expect(parseTotalCellRangeValues(3, 5)).toEqual({ min: 3, max: 5 });
    expect(parseTotalCellRangeValues(null, 5)).toEqual({ min: null, max: 5 });
    expect(() => parsePositiveIntegerValue('1.2', '藏品总件数')).toThrow('藏品总件数 必须是整数');
    expect(() => parseRequiredPositiveIntegerValue('0', '宽')).toThrow('宽 必须是正整数');
    expect(() => parseTotalCellRangeValues(6, 5)).toThrow('所有藏品最小格数不能大于最大格数');
  });

  it('builds reachable sums and pair maps', () => {
    const reachable = buildReachableSums([1, 3], 3);
    expect([...reachable[0]]).toEqual([0]);
    expect([...reachable[2]].sort((a, b) => a - b)).toEqual([2, 4, 6]);
    expect([...reachable[3]].sort((a, b) => a - b)).toEqual([3, 5, 7, 9]);

    const pairMap = buildPairMap([0, 1], [2, 3]);
    expect(pairMap.get(3)).toEqual([[0, 3], [1, 2]]);
  });

  it('finds possible group counts from cell and price constraints', () => {
    const group = { key: 'blue' };
    const groupCellValues = { blue: [1, 2, 3] };

    expect(getPossibleCounts({
      group,
      avg: avg('2'),
      targetCount: null,
      totalCells: null,
      priceAverage: null,
      totalPrice: null,
      totalCount: 4,
      groupCellValues,
    })).toEqual([1, 2, 3, 4]);

    expect(getPossibleCounts({
      group,
      avg: null,
      targetCount: null,
      totalCells: 0,
      priceAverage: null,
      totalPrice: null,
      totalCount: 4,
      groupCellValues,
    })).toEqual([0]);

    expect(getPossibleCounts({
      group,
      avg: avg('0'),
      targetCount: 1,
      totalCells: null,
      priceAverage: null,
      totalPrice: null,
      totalCount: 4,
      groupCellValues,
    })).toEqual([]);

    expect(getPossibleCounts({
      group,
      avg: null,
      targetCount: 2,
      totalCells: 4,
      priceAverage: null,
      totalPrice: 500,
      totalCount: 4,
      groupCellValues,
      canResolveGroupPriceTarget: (_groupKey, count, targetCells, totalPrice) =>
        count === 2 && targetCells === 4 && totalPrice === 500,
    })).toEqual([2]);

    expect(getPossibleCounts({
      group,
      avg: null,
      targetCount: 2,
      totalCells: 4,
      priceAverage: null,
      totalPrice: 501,
      totalCount: 4,
      groupCellValues,
      canResolveGroupPriceTarget: () => false,
    })).toEqual([]);
  });

  it('resolves non-red and red target cells for rows', () => {
    const row = { wg: 1, blue: 2, purple: 0, orange: 0, red: 1 };
    const targets = { wg: 2, blue: 6, purple: 0, orange: 0 };
    const getGroupTarget = groupKey => targets[groupKey];
    const getNonRedTargetCellsForRow = targetRow => getNonRedTargetCells(targetRow, { getGroupTarget });
    const getRedTargetCellsForRow = (targetRow, totalCells) =>
      getRedTargetCells(targetRow, totalCells, { getNonRedTargetCellsForRow });

    expect(getNonRedTargetCells(row, { getGroupTarget })).toBe(8);
    expect(getRedTargetCells(row, 12, { getNonRedTargetCellsForRow })).toBe(4);
    expect(resolveRedTargetCells(row, {
      totalCells: 12,
      redAverage: avg('4'),
      getRedTargetCellsForRow,
    })).toBe(4);
    expect(resolveRedTargetCells(row, {
      totalCells: 12,
      redAverage: avg('5'),
      getRedTargetCellsForRow,
    })).toBeNull();
  });

  it('matches known constraints and total cell ranges', () => {
    const row = { wg: 1, blue: 2, purple: 0, orange: 0, red: 2 };
    const summary = {
      groups: {
        wg: { count: 0, cells: 0 },
        blue: { count: 1, cells: 2 },
        purple: { count: 0, cells: 0 },
        orange: { count: 0, cells: 0 },
      },
      red: { count: 1, cells: 2 },
    };
    const getGroupTarget = groupKey => ({ wg: 1, blue: 5, purple: 0, orange: 0 })[groupKey];
    const groupReachable = buildGroupReachable(3, {
      groupCellValues: {
        wg: [1],
        blue: [3],
        purple: [1],
        orange: [1],
      },
    });
    const redReachable = buildReachableSums([3], 3);
    const getNonRedTargetCellsForRow = targetRow => getNonRedTargetCells(targetRow, { getGroupTarget });

    expect(matchesKnownConstraints(row, 5, {
      summary,
      groupReachable,
      redReachable,
      getGroupTarget,
    })).toBe(true);
    expect(matchesKnownConstraints({ ...row, blue: 0 }, 5, {
      summary,
      groupReachable,
      redReachable,
      getGroupTarget,
    })).toBe(false);
    expect(matchesTotalCellRange(row, 5, {
      totalCellRange: { min: 10, max: 12 },
      redReachable,
      knownSummary: summary,
      getNonRedTargetCellsForRow,
    })).toBe(true);
    expect(matchesTotalCellRange(row, null, {
      totalCellRange: { min: 11, max: 11 },
      redReachable,
      knownSummary: summary,
      getNonRedTargetCellsForRow,
    })).toBe(true);
    expect(matchesTotalCellRange(row, null, {
      totalCellRange: { min: 99, max: 100 },
      redReachable,
      knownSummary: summary,
      getNonRedTargetCellsForRow,
    })).toBe(false);
  });

  it('sorts and selects items by Ahmed priority rules', () => {
    const items = [
      { name: '乙', price: 90, cells: 4 },
      { name: '甲', price: 90, cells: 2 },
      { name: '丙', price: 120, cells: 1 },
    ];

    expect(pickItems(items, 2).map(item => item.name)).toEqual(['甲', '乙']);
    expect(pickItems(items, 4)).toBeNull();
    expect(sumItemCells(items)).toBe(7);
    expect(findItemsForTotal(items, 2, 6)?.map(item => item.name)).toEqual(['甲', '乙']);
    expect(findItemsForTotal(items, 2, 99)).toBeNull();

    const rows = [
      { wg: 1, blue: 0, purple: 1, orange: 0, red: 0 },
      { wg: 0, blue: 0, purple: 1, orange: 0, red: 1 },
      { wg: 0, blue: 1, purple: 0, orange: 1, red: 0 },
    ];
    expect([...rows].sort(comparePriority)).toEqual([rows[0], rows[2], rows[1]]);
  });

  it('maps known constraints and exact item search metadata', () => {
    expect(getGroupKeyForQuality('白')).toBe('wg');
    expect(getGroupKeyForQuality('绿')).toBe('wg');
    expect(getGroupKeyForQuality('金')).toBe('orange');
    expect(getGroupKeyForQuality('红')).toBe('red');
    expect(getGroupKeyForQuality('未知')).toBeNull();
    expect(makeSizeKey(2, 3)).toBe('2x3');
    expect(getPinyinInitials('西A!9')).toBe('xa9');
    expect(getKnownConstraintLabel({ type: 'outline', quality: '金', sizeKey: '2x3' })).toBe('轮廓：橙/金 · 2x3');
    expect(getKnownConstraintLabel({ type: 'exact', name: '星辉', quality: '红', sizeKey: '1x2' })).toBe('精确：星辉 · 红 · 1x2');
  });

  it('builds red size statistics and formats money', () => {
    const items = [
      { name: '低', sizeKey: '2x2', cells: 4, price: 100 },
      { name: '中', sizeKey: '2x2', cells: 4, price: 200 },
      { name: '高', sizeKey: '2x2', cells: 4, price: 600000 },
      { name: '小', sizeKey: '1x1', cells: 1, price: 50 },
    ];

    const stats = buildRedStats(items);

    expect(stats.map(stat => stat.sizeKey)).toEqual(['1x1', '2x2']);
    expect(stats[1]).toMatchObject({
      sizeKey: '2x2',
      cells: 4,
      count: 3,
      min: items[0],
      median: items[1],
      max: items[2],
      expectedPrice: 120,
    });
    expect(formatMoney(1234567)).toBe('1,234,567');
  });

  it('resolves exact and outline known constraints for a group', () => {
    const items = [
      { id: 'blue-a', name: '蓝甲', quality: '蓝', groupKey: 'blue', sizeKey: '1x2', cells: 2, price: 100 },
      { id: 'blue-b', name: '蓝乙', quality: '蓝', groupKey: 'blue', sizeKey: '1x2', cells: 2, price: 80 },
      { id: 'blue-c', name: '蓝丙', quality: '蓝', groupKey: 'blue', sizeKey: '2x2', cells: 4, price: 90 },
      { id: 'red-a', name: '红甲', quality: '红', groupKey: 'red', sizeKey: '1x1', cells: 1, price: 300 },
    ];
    const context = {
      itemsByGroup: {
        blue: items.filter(item => item.groupKey === 'blue'),
        red: items.filter(item => item.groupKey === 'red'),
      },
      itemById: new Map(items.map(item => [item.id, item])),
      allItems: items,
      knownConstraints: [
        { type: 'exact', groupKey: 'blue', itemId: 'blue-a', quality: '蓝', sizeKey: '1x2', cells: 2, price: 100 },
        { type: 'outline', groupKey: 'blue', quality: '蓝', sizeKey: '1x2', cells: 2 },
        { type: 'outline', groupKey: 'blue', quality: '蓝', sizeKey: '1x2', cells: 2 },
      ],
    };

    const resolved = resolveKnownItemsForGroup('blue', context);

    expect(getConstraintItem(context.knownConstraints[0], context)).toBe(items[0]);
    expect(resolved.items.map(item => item.id)).toEqual(['blue-a', 'blue-b']);
    expect([...resolved.itemIds]).toEqual(['blue-a', 'blue-b']);
    expect([...resolved.exactIds]).toEqual(['blue-a']);
    expect(resolved.cells).toBe(4);
    expect(resolved.exactPrice).toBe(100);
  });

  it('allows duplicate exact known constraints for repeated game collectibles', () => {
    const items = [
      { id: 'blue-a', name: '蓝甲', quality: '蓝', groupKey: 'blue', sizeKey: '1x2', cells: 2, price: 100 },
      { id: 'blue-b', name: '蓝乙', quality: '蓝', groupKey: 'blue', sizeKey: '1x1', cells: 1, price: 80 },
    ];
    const context = {
      itemsByGroup: { blue: items },
      itemById: new Map(items.map(item => [item.id, item])),
      allItems: items,
      knownConstraints: [
        { type: 'exact', groupKey: 'blue', itemId: 'blue-a', quality: '蓝', sizeKey: '1x2', cells: 2, price: 100 },
        { type: 'exact', groupKey: 'blue', itemId: 'blue-a', quality: '蓝', sizeKey: '1x2', cells: 2, price: 100 },
      ],
    };

    const resolved = resolveKnownItemsForGroup('blue', context);

    expect(resolved.items.map(item => item.id)).toEqual(['blue-a', 'blue-a']);
    expect([...resolved.itemIds]).toEqual(['blue-a']);
    expect([...resolved.exactIds]).toEqual(['blue-a']);
    expect(resolved.cells).toBe(4);
    expect(resolved.exactPrice).toBe(200);

    const selected = resolveSelectedItems('blue', {
      count: 3,
      targetCells: 5,
      itemsByGroup: { blue: items },
      knownConstraints: context.knownConstraints,
      itemById: context.itemById,
      allItems: items,
    });

    expect(selected.items.map(item => item.id)).toEqual(['blue-a', 'blue-a', 'blue-b']);
  });

  it('selects remaining items with custom ordering when no target cells are fixed', () => {
    const items = [
      { id: 'blue-a', name: '蓝甲', quality: '蓝', groupKey: 'blue', sizeKey: '1x2', cells: 2, price: 100, expected: 80 },
      { id: 'blue-b', name: '蓝乙', quality: '蓝', groupKey: 'blue', sizeKey: '1x3', cells: 3, price: 90, expected: 20 },
      { id: 'blue-c', name: '蓝丙', quality: '蓝', groupKey: 'blue', sizeKey: '1x4', cells: 4, price: 70, expected: 60 },
    ];

    const selection = resolveSelectedItems('blue', {
      count: 2,
      itemsByGroup: { blue: items },
      knownConstraints: [
        { type: 'exact', groupKey: 'blue', itemId: 'blue-a', quality: '蓝', sizeKey: '1x2', cells: 2, price: 100 },
      ],
      itemById: new Map(items.map(item => [item.id, item])),
      allItems: items,
      compareRemainingItems: (a, b) => a.expected - b.expected,
    });

    expect(selection.items.map(item => item.id)).toEqual(['blue-a', 'blue-b']);
    expect([...selection.exactIds]).toEqual(['blue-a']);
  });

  it('selects remaining items by target cells and rejects impossible targets', () => {
    const items = [
      { id: 'blue-a', name: '蓝甲', quality: '蓝', groupKey: 'blue', sizeKey: '1x2', cells: 2, price: 100 },
      { id: 'blue-b', name: '蓝乙', quality: '蓝', groupKey: 'blue', sizeKey: '1x3', cells: 3, price: 80 },
      { id: 'blue-c', name: '蓝丙', quality: '蓝', groupKey: 'blue', sizeKey: '1x4', cells: 4, price: 70 },
    ];
    const context = {
      itemsByGroup: { blue: items },
      knownConstraints: [
        { type: 'outline', groupKey: 'blue', quality: '蓝', sizeKey: '1x2', cells: 2 },
      ],
      itemById: new Map(items.map(item => [item.id, item])),
      allItems: items,
    };

    const selection = resolveSelectedItems('blue', {
      ...context,
      count: 2,
      targetCells: 6,
    });

    expect(selection.items.map(item => item.id)).toEqual(['blue-a', 'blue-c']);
    expect(resolveSelectedItems('blue', { ...context, count: 1, targetCells: 6 })).toBeNull();
    expect(resolveSelectedItems('blue', { ...context, count: 2, targetCells: 99 })).toBeNull();
    expect(resolveSelectedItems('purple', { ...context, count: 1 })).toBeNull();
  });

  it('returns an empty selection for zero-count empty groups', () => {
    const selection = resolveSelectedItems('blue', {
      count: 0,
      itemsByGroup: { blue: [] },
      knownConstraints: [],
    });

    expect(selection.items).toEqual([]);
    expect([...selection.exactIds]).toEqual([]);
  });

  it('calculates expected item prices and selected item totals', () => {
    const averagePriceByQualitySize = {
      蓝: { '1x2': { averagePrice: 100 } },
      紫: { '2x2': { averagePrice: 300 } },
    };
    const blueItem = { id: 'blue-a', quality: '蓝', sizeKey: '1x2', price: 120 };
    const purpleItem = { id: 'purple-a', quality: '紫', sizeKey: '2x2', price: 500 };

    expect(getExpectedItemPrice('blue', blueItem, { averagePriceByQualitySize })).toBe(90);
    expect(getExpectedPriceForQualitySize('purple', '紫', '2x2', { averagePriceByQualitySize })).toBe(264);
    expect(getExpectedItemPrice('blue', { quality: '蓝', sizeKey: '9x9' }, { averagePriceByQualitySize })).toBeNull();
    expect(getExpectedPriceForSelectedItem('blue', blueItem, new Set(['blue-a']), {
      getExpectedItemPriceForGroup: () => 999,
    })).toBe(120);
    expect(getExpectedPriceForSelectedItem('red', { id: 'red-a' }, new Set(), {
      getRedExpectedItemPrice: () => 777,
    })).toBe(777);
    expect(getExpectedPriceForSelectedItem('blue', blueItem, new Set(), {
      getExpectedItemPriceForGroup: () => 88,
    })).toBe(88);
    expect(getExpectedPriceForSelectedItem('purple', purpleItem, new Set(), {
      getExpectedItemPriceForGroup: () => null,
    })).toBeNull();
  });

  it('calculates group and red expected totals', () => {
    const selection = {
      items: [
        { id: 'exact', price: 150 },
        { id: 'estimate', price: 80 },
      ],
      exactIds: new Set(['exact']),
    };
    const resolveSelectedItemsForGroup = () => selection;
    const getExpectedPriceForSelectedItemForGroup = (_groupKey, item, exactIds) =>
      exactIds.has(item.id) ? item.price : 40;

    expect(getGroupExpectedTotal({
      groupKey: 'blue',
      count: 2,
      target: null,
      resolveSelectedItemsForGroup,
      getExpectedPriceForSelectedItemForGroup,
    })).toBe(190);
    expect(getRedExpectedTotal({
      redCount: 2,
      resolveSelectedItemsForGroup,
      getExpectedPriceForSelectedItemForGroup,
    })).toBe(190);
    expect(getRedExpectedTotal({ redCount: 0 })).toBe(0);
    expect(getGroupExpectedTotal({
      groupKey: 'blue',
      count: 2,
      target: null,
      resolveSelectedItemsForGroup: () => null,
      getExpectedPriceForSelectedItemForGroup,
    })).toBeNull();
  });

  it('honors explicit price constraints for group expected totals', () => {
    const selection = {
      items: [
        { id: 'exact', price: 150 },
        { id: 'other', price: 80 },
      ],
      exactIds: new Set(['exact']),
    };

    expect(getGroupExpectedTotal({
      groupKey: 'blue',
      count: 2,
      target: 5,
      totalPriceInput: 220,
      resolveSelectedItemsForGroup: () => selection,
      getExpectedPriceForSelectedItemForGroup: () => 1,
      canResolveGroupPriceTarget: (_groupKey, count, target, totalPrice) =>
        count === 2 && target === 5 && totalPrice === 220,
    })).toBe(220);
    expect(getGroupExpectedTotal({
      groupKey: 'blue',
      count: 2,
      target: 5,
      totalPriceInput: 120,
      resolveSelectedItemsForGroup: () => selection,
      getExpectedPriceForSelectedItemForGroup: () => 1,
    })).toBeNull();
    expect(getGroupExpectedTotal({
      groupKey: 'blue',
      count: 2,
      target: 5,
      priceAverage: avg('100'),
      totalPriceInput: 201,
      resolveSelectedItemsForGroup: () => selection,
      getExpectedPriceForSelectedItemForGroup: () => 1,
    })).toBeNull();
  });

  it('aggregates row totals and checks price constrained groups', () => {
    const row = { wg: 1, blue: 2, purple: 3, orange: 4 };
    const totals = { wg: 10, blue: 20, purple: 30, orange: 40 };

    expect(getExpectedTotal(row, {
      getGroupExpectedTotalForGroup: groupKey => totals[groupKey],
    })).toBe(100);
    expect(getExpectedTotal(row, {
      getGroupExpectedTotalForGroup: groupKey => groupKey === 'purple' ? null : totals[groupKey],
    })).toBeNull();
    expect(matchesPriceConstraints(row, {
      priceAverages: { wg: avg('10'), blue: null, purple: null, orange: null },
      totalPrices: { wg: null, blue: null, purple: 500, orange: null },
      getGroupExpectedTotalForGroup: groupKey => groupKey === 'purple' ? null : totals[groupKey],
    })).toBe(false);
    expect(matchesPriceConstraints(row, {
      priceAverages: { wg: avg('10'), blue: null, purple: null, orange: null },
      totalPrices: { wg: null, blue: null, purple: null, orange: null },
      getGroupExpectedTotalForGroup: groupKey => totals[groupKey],
    })).toBe(true);
  });

  it('builds detail sections for non-red and red selections', () => {
    const row = { wg: 1, blue: 1, purple: 0, orange: 0, red: 1, redTargetCells: 3 };
    const selections = {
      wg: {
        items: [{ id: 'wg-a', price: 10, cells: 2 }],
        exactIds: new Set(),
      },
      blue: {
        items: [{ id: 'blue-a', price: 20, cells: 3 }],
        exactIds: new Set(['blue-a']),
      },
      purple: { items: [], exactIds: new Set() },
      orange: { items: [], exactIds: new Set() },
      red: {
        items: [{ id: 'red-a', price: 100, cells: 3 }],
        exactIds: new Set(),
      },
    };
    const targets = { wg: 2, blue: 3, purple: 0, orange: 0 };

    const detail = getDetailForRow(row, {
      getGroupTarget: groupKey => targets[groupKey],
      getRedTargetCells: () => 99,
      resolveSelectedItemsForGroup: groupKey => selections[groupKey],
      getExpectedPriceForSelectedItemForGroup: (groupKey, item, exactIds) =>
        exactIds.has(item.id) ? item.price : groupKey === 'red' ? 75 : 15,
      getGroupExpectedTotalForGroup: groupKey => ({ wg: 15, blue: 20, purple: 0, orange: 0 })[groupKey],
      getRedExpectedTotalForGroup: () => 75,
    });

    expect(detail.totalPrice).toBe(130);
    expect(detail.totalCells).toBe(8);
    expect(detail.sections.map(section => section.label)).toEqual(['白+绿', '蓝', '紫', '橙/金', '红']);
    expect(detail.sections[0]).toMatchObject({ count: 1, target: 2, price: 10, cells: 2, expectedPrice: 15 });
    expect(detail.sections[0].items[0].expectedPrice).toBe(15);
    expect(detail.sections[1].items[0].expectedPrice).toBe(20);
    expect(detail.sections[4]).toMatchObject({ label: '红', count: 1, target: 3, price: 100, cells: 3, expectedPrice: 75 });
  });

  it('checks whether full rows can resolve concrete item selections', () => {
    const row = { wg: 1, blue: 1, purple: 0, orange: 0, red: 1 };
    const getGroupTarget = groupKey => ({ wg: 2, blue: 3, purple: 0, orange: 0 })[groupKey];
    const getRedTargetCellsForRow = () => 4;

    expect(canResolveRow(row, {
      itemsByGroup: null,
      getGroupTarget,
      getRedTargetCellsForRow,
      resolveSelectedItemsForGroup: () => null,
    })).toBe(true);
    expect(canResolveRow(row, {
      itemsByGroup: { wg: [], blue: [], purple: [], orange: [], red: [] },
      getGroupTarget,
      getRedTargetCellsForRow,
      resolveSelectedItemsForGroup: () => ({ items: [], exactIds: new Set() }),
    })).toBe(true);
    expect(canResolveRow(row, {
      itemsByGroup: { wg: [], blue: [], purple: [], orange: [], red: [] },
      getGroupTarget,
      getRedTargetCellsForRow,
      resolveSelectedItemsForGroup: groupKey => groupKey === 'blue' ? null : { items: [], exactIds: new Set() },
    })).toBe(false);
  });

  it('calculates combinations with filtering callbacks', () => {
    const knownSummary = {
      invalid: false,
      groups: {
        wg: { count: 0, cells: 0 },
        blue: { count: 0, cells: 0 },
        purple: { count: 0, cells: 0 },
        orange: { count: 0, cells: 0 },
      },
      red: { count: 0, cells: 0 },
    };

    const result = calculateCombinations({
      totalCount: 3,
      possible: { wg: [1], blue: [1], purple: [0], orange: [0] },
      limit: 10,
      redCount: null,
      totalCells: null,
      redAverage: null,
      totalCellRange: { min: null, max: null },
      knownSummary,
      redCellValues: [1],
      groupCellValues: { wg: [1], blue: [1], purple: [1], orange: [1] },
      getGroupTarget: (_groupKey, count) => count,
      getNonRedTargetCellsForRow: targetRow => targetRow.wg + targetRow.blue + targetRow.purple + targetRow.orange,
      getRedTargetCellsForRow: () => null,
      canResolveRowForRow: () => true,
      matchesPriceConstraintsForRow: () => true,
      getRedExpectedTotalForRow: red => red * 100,
      getExpectedTotalForRow: () => 25,
    });

    expect(result).toEqual({
      results: [{ wg: 1, blue: 1, purple: 0, orange: 0, red: 1, redTargetCells: null, expectedTotal: 25, redExpectedTotal: 100 }],
      totalMatches: 1,
      stoppedEarly: false,
    });
    expect(calculateCombinations({
      totalCount: 3,
      possible: { wg: [1], blue: [1], purple: [0], orange: [0] },
      limit: 10,
      redCount: null,
      totalCells: null,
      redAverage: null,
      knownSummary: { ...knownSummary, invalid: true },
    })).toEqual({ results: [], totalMatches: 0, stoppedEarly: false });
  });

  it('returns null when detail selections cannot be resolved', () => {
    const row = { wg: 1, blue: 0, purple: 0, orange: 0, red: 1 };
    const baseOptions = {
      getGroupTarget: () => 1,
      getRedTargetCells: () => 1,
      getExpectedPriceForSelectedItemForGroup: () => 1,
      getGroupExpectedTotalForGroup: () => 1,
      getRedExpectedTotalForGroup: () => 1,
    };

    expect(getDetailForRow(row, {
      ...baseOptions,
      resolveSelectedItemsForGroup: groupKey => groupKey === 'wg' ? null : { items: [], exactIds: new Set() },
    })).toBeNull();
    expect(getDetailForRow(row, {
      ...baseOptions,
      resolveSelectedItemsForGroup: groupKey => groupKey === 'red' ? null : { items: [], exactIds: new Set() },
    })).toBeNull();
  });

  it('marks known constraint summaries invalid when constraints cannot be resolved', () => {
    const knownConstraints = [
      { type: 'exact', groupKey: 'blue', itemId: 'missing', quality: '蓝', sizeKey: '1x2', cells: 2, price: 100 },
      { type: 'outline', groupKey: 'red', quality: '红', sizeKey: '1x1', cells: 1 },
    ];

    const rawSummary = buildRawKnownConstraintSummary(knownConstraints);
    expect(rawSummary.groups.blue).toMatchObject({ count: 1, cells: 2, exactCount: 1, exactPrice: 100 });
    expect(rawSummary.red).toMatchObject({ count: 1, cells: 1, exactCount: 0, exactPrice: 0 });
    expect(hasKnownConstraints(rawSummary)).toBe(true);

    const unresolved = getKnownConstraintSummary({
      knownConstraints,
      itemsByGroup: { blue: [], red: [] },
      itemById: new Map(),
      allItems: [],
    });
    expect(unresolved.invalid).toBe(true);

    const empty = getKnownConstraintSummary({ knownConstraints: [] });
    expect(empty.invalid).toBe(false);
    expect(hasKnownConstraints(empty)).toBe(false);
  });
});
