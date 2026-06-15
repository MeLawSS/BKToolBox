import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
} = require('./bidking-hero-profiles.js');
const {
  buildBidKingMonitorFacts,
} = require('./bidking-monitor-facts.js');
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = require('./bidking-monitor-store.js');

describe('BidKing monitor store', () => {
  it('resets all match state when a new game fact arrives', () => {
    const first = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 29 },
    ]);
    const second = applyBidKingMonitorFacts(first, [
      { type: 'game.changed', key: 'game-2', gameUid: 'game-2' },
    ]);

    expect(first.groups.blue.totalCells).toBe(29);
    expect(second.gameUid).toBe('game-2');
    expect(second.groups.blue.totalCells).toBeNull();
    expect(second.outlines).toEqual([]);
  });

  it('applies aggregate group facts', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 29 },
      { type: 'group.averageCellsKnown', key: 'purple-avg', gameUid: 'game-1', group: 'purple', value: 2.8 },
      { type: 'group.averagePriceKnown', key: 'orange-price', gameUid: 'game-1', group: 'orange', value: 30472 },
    ]);

    expect(state.groups.blue.totalCells).toBe(29);
    expect(state.groups.purple.averageCells).toBe(2.8);
    expect(state.groups.orange.averagePrice).toBe(30472);
  });

  it('merges quality and outline facts regardless of arrival order', () => {
    const qualityFirst = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'item.qualityCellsRevealed', key: 'quality-2', gameUid: 'game-1', cells: [2], quality: { id: 4, name: '紫', group: 'purple' } },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2, 11, 12], width: 2, height: 2, label: '2x2', quality: null },
    ]);

    const outlineFirst = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2, 11, 12], width: 2, height: 2, label: '2x2', quality: null },
      { type: 'item.qualityCellsRevealed', key: 'quality-2', gameUid: 'game-1', cells: [2], quality: { id: 4, name: '紫', group: 'purple' } },
    ]);

    expect(qualityFirst.outlines[0]).toMatchObject({ qualityName: '紫', qualityGroup: 'purple', qualityStatus: 'confirmed' });
    expect(outlineFirst.outlines[0]).toMatchObject({ qualityName: '紫', qualityGroup: 'purple', qualityStatus: 'confirmed' });
  });

  it('marks same-group overlapping distinct qualities as conflict', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2], width: 2, height: 1, label: '2x1', quality: null },
      { type: 'item.qualityCellsRevealed', key: 'quality-white', gameUid: 'game-1', cells: [1], quality: { id: 1, name: '白', group: 'wg' } },
      { type: 'item.qualityCellsRevealed', key: 'quality-green', gameUid: 'game-1', cells: [2], quality: { id: 2, name: '绿', group: 'wg' } },
    ]);

    expect(state.outlines[0]).toMatchObject({ qualityStatus: 'conflict' });
    expect(state.outlines[0].qualityId).toBeUndefined();
    expect(state.outlines[0].qualityName).toBeUndefined();
    expect(state.outlines[0].qualityGroup).toBeUndefined();
  });

  it('re-evaluates direct outline quality when later overlapping quality cells conflict', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2], width: 2, height: 1, label: '2x1', quality: { id: 1, name: '白', group: 'wg' } },
      { type: 'item.qualityCellsRevealed', key: 'quality-green', gameUid: 'game-1', cells: [2], quality: { id: 2, name: '绿', group: 'wg' } },
    ]);

    expect(state.outlines[0]).toMatchObject({ qualityStatus: 'conflict' });
    expect(state.outlines[0].qualityId).toBeUndefined();
    expect(state.outlines[0].qualityName).toBeUndefined();
    expect(state.outlines[0].qualityGroup).toBeUndefined();
  });

  it('dedupes facts by fact key', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 29 },
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 30 },
    ]);

    expect(state.groups.blue.totalCells).toBe(29);
    expect(state.seenFactKeys).toEqual(['game-1:blue-cells']);
  });

  it('applies later same-key outline payloads when the revealed boxes change', () => {
    const earlyFacts = buildBidKingMonitorFacts({
      key: 'skill:ethan-outline',
      gameUid: '2406:1274127991640675',
      round: 2,
      skill: {
        uid: 'ethan-outline',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 77, itemSlotType: 11 }],
      },
    });
    const laterFacts = buildBidKingMonitorFacts({
      key: 'skill:ethan-outline',
      gameUid: '2406:1274127991640675',
      round: 5,
      skill: {
        uid: 'ethan-outline',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 136, itemSlotType: 11 }],
      },
    });

    const early = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), earlyFacts);
    const later = applyBidKingMonitorFacts(early, laterFacts);

    expect(early.minimumOccupied.minTotalCells).toBe(78);
    expect(later.minimumOccupied.minTotalCells).toBe(137);
  });

  it('handles a new game fact before deduping same keys from the previous game', () => {
    const first = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'group.totalCellsKnown', key: 'shared-cells', gameUid: 'game-1', group: 'blue', value: 29 },
    ]);
    const second = applyBidKingMonitorFacts(first, [
      { type: 'group.totalCellsKnown', key: 'shared-cells', gameUid: 'game-2', group: 'blue', value: 30 },
    ]);

    expect(second.gameUid).toBe('game-2');
    expect(second.groups.blue.totalCells).toBe(30);
    expect(second.seenFactKeys).toEqual(['game-2:shared-cells']);
  });

  it('does not reset same-game facts when game uid is numeric', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 1001, group: 'blue', value: 29 },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 1001, boxId: 1, protocolBoxId: 0, cells: [1, 2], width: 2, height: 1, label: '2x1', quality: null },
    ]);

    expect(state.gameUid).toBe('1001');
    expect(state.groups.blue.totalCells).toBe(29);
    expect(state.outlines).toHaveLength(1);
    expect(state.seenFactKeys).toEqual(['1001:blue-cells', '1001:outline-1']);
  });

  it('preserves direct outline metadata when a repeated partial outline arrives', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.outlineRevealed', key: 'outline-full', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2], width: 2, height: 1, label: '2x1', quality: { id: 4, name: '紫', group: 'purple' }, itemCid: 1033001, itemName: '测试藏品', itemPrice: 12345 },
      { type: 'item.outlineRevealed', key: 'outline-partial', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2], width: 2, height: 1, label: '2x1', quality: null },
    ]);

    expect(state.outlines).toHaveLength(1);
    expect(state.outlines[0]).toMatchObject({
      qualityId: 4,
      qualityName: '紫',
      qualityGroup: 'purple',
      qualitySource: 'direct',
      itemCid: 1033001,
      itemName: '测试藏品',
      price: 12345,
    });
  });

  it('preserves shaped exact item outline metadata through facts into state', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:exact-outline',
      gameUid: 'game-1',
      skill: {
        uid: 'exact-outline-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemCid: 1033001,
          itemName: '测试藏品',
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          itemPrice: 3851,
        }],
      },
    });

    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), facts);

    expect(state.outlines[0]).toMatchObject({
      boxId: 26,
      label: '2x2',
      cells: [26, 27, 36, 37],
      qualityName: '蓝',
      qualityGroup: 'blue',
      itemCid: 1033001,
      itemName: '测试藏品',
      price: 3851,
    });
  });

  it('merges later exact item facts into an existing same-skill outline', () => {
    const partialFacts = buildBidKingMonitorFacts({
      key: 'skill:same-skill',
      gameUid: 'game-1',
      skill: {
        uid: 'same-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
        }],
      },
    });
    const exactFacts = buildBidKingMonitorFacts({
      key: 'skill:same-skill',
      gameUid: 'game-1',
      skill: {
        uid: 'same-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemCid: 1033001,
          itemName: '测试藏品',
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          itemPrice: 3851,
        }],
      },
    });

    const partialState = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), partialFacts);
    const exactState = applyBidKingMonitorFacts(partialState, exactFacts);

    expect(exactState.outlines[0]).toMatchObject({
      boxId: 26,
      label: '2x2',
      cells: [26, 27, 36, 37],
      itemCid: 1033001,
      itemName: '测试藏品',
      price: 3851,
    });
  });

  it('preserves cells and metadata when a repeated partial outline omits cells', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.outlineRevealed', key: 'outline-full', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2], width: 2, height: 1, label: '2x1', quality: { id: 4, name: '紫', group: 'purple' }, itemCid: 1033001, itemName: '测试藏品', itemPrice: 12345 },
      { type: 'item.outlineRevealed', key: 'outline-partial', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, width: 2, height: 1, label: '2x1', quality: null },
    ]);

    expect(state.outlines).toHaveLength(1);
    expect(state.outlines[0]).toMatchObject({
      cells: [1, 2],
      qualityId: 4,
      qualityName: '紫',
      qualityGroup: 'purple',
      qualitySource: 'direct',
      itemCid: 1033001,
      itemName: '测试藏品',
      price: 12345,
    });
    expect(state.minimumOccupied).toMatchObject({
      valid: true,
      minTotalCells: 2,
      knownOutlineCellCount: 2,
    });
  });

  it('tolerates a first-time partial outline that omits cells', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.outlineRevealed', key: 'outline-partial', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, width: 2, height: 1, label: '2x1', quality: null },
    ]);

    expect(state.outlines).toHaveLength(1);
    expect(state.outlines[0]).toMatchObject({ boxId: 1, width: 2, height: 1, label: '2x1' });
    expect(state.outlines[0].cells).toBeUndefined();
    expect(state.minimumOccupied).toBeNull();
  });

  it('ignores first-time outlines with invalid cells for minimum occupancy', () => {
    const emptyCells = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.outlineRevealed', key: 'outline-empty', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [], width: 2, height: 1, label: '2x1', quality: null },
    ]);
    const undefinedCell = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.outlineRevealed', key: 'outline-invalid', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [undefined], width: 2, height: 1, label: '2x1', quality: null },
    ]);

    expect(emptyCells.outlines).toHaveLength(1);
    expect(emptyCells.minimumOccupied).toBeNull();
    expect(undefinedCell.outlines).toHaveLength(1);
    expect(undefinedCell.minimumOccupied).toBeNull();
  });

  it('ignores invalid quality revealed cells without throwing', () => {
    const scalarCells = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.qualityCellsRevealed', key: 'quality-scalar', gameUid: 'game-1', cells: 2, quality: { id: 4, name: '紫', group: 'purple' } },
    ]);
    const invalidCells = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.qualityCellsRevealed', key: 'quality-invalid', gameUid: 'game-1', cells: [undefined, 0, 431], quality: { id: 4, name: '紫', group: 'purple' } },
    ]);

    expect(scalarCells.qualityCells).toEqual([]);
    expect(invalidCells.qualityCells).toEqual([]);
  });

  it('merges revealed item types', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'type.revealed', key: 'type-1', gameUid: 'game-1', itemTypes: ['家居日用', '数码电子'] },
      { type: 'type.revealed', key: 'type-2', gameUid: 'game-1', itemTypes: ['数码电子', '潮流玩具'] },
    ]);

    expect(state.revealedTypes).toEqual(['家居日用', '数码电子', '潮流玩具']);
  });

  it('merges exact revealed items', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.exactRevealed', key: 'exact-1', gameUid: 'game-1', itemCid: 1033001, itemName: '测试藏品', itemPrice: 12345, cells: [1], quality: { id: 4, name: '紫', group: 'purple' } },
      { type: 'item.exactRevealed', key: 'exact-2', gameUid: 'game-1', itemCid: 1033002, itemName: '另一个藏品', itemPrice: 23456, cells: [2], quality: { id: 5, name: '金', group: 'orange' } },
    ]);

    expect(state.exactItems).toEqual([
      expect.objectContaining({ key: '1033001:1', itemCid: 1033001, itemName: '测试藏品', cells: [1] }),
      expect.objectContaining({ key: '1033002:2', itemCid: 1033002, itemName: '另一个藏品', cells: [2] }),
    ]);
  });

  it('computes minimum occupied cells after outline facts', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2, 11, 12], width: 2, height: 2, label: '2x2', quality: null },
    ]);

    expect(state.minimumOccupied).toMatchObject({
      valid: true,
      minTotalCells: 4,
      knownOutlineCellCount: 4,
      order: [1],
    });
  });

  it('derives Elsa primary-group total cells from complete reveal outlines', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:elsa-green',
      gameUid: 'game-1',
      round: 2,
      group: 'hero',
      skill: {
        uid: 'elsa-green',
        heroCid: 103,
        skillCid: 1001033,
        hitBoxList: [
          { boxId: 0, itemSlotType: 21, itemQuility: 2, itemQuilityName: '绿' },
          { boxId: 10, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' },
        ],
      },
    }, ELSA_MONITOR_PROFILE);

    const state = applyBidKingMonitorFacts(
      createEmptyBidKingMonitorState(ELSA_MONITOR_PROFILE),
      facts,
      ELSA_MONITOR_PROFILE,
    );

    expect(state.profileId).toBe('elsa');
    expect(state.groups.green.totalCells).toBe(3);
    expect(state.groups.white.totalCells).toBeNull();
    expect(Object.keys(state.groups)).toEqual(['white', 'green', 'blue', 'purple', 'orange', 'red']);
  });
});
