import { describe, expect, it } from 'vitest';
import {
  applyMonitorEventToGridState,
  createEmptyMonitorGridState,
  createMonitorCells,
  inferMinimumOccupiedCells,
  parseSlotType,
} from './monitor-grid.js';

function skillEvent(overrides = {}) {
  return {
    key: 'event-1',
    gameUid: 'game-1',
    skill: {
      uid: 'skill-1',
      skillCid: 1002081,
      hitItemTypeNames: ['武器装备', '家居日用'],
      hitBoxList: [
        { boxId: 0, itemSlotType: 11 },
        { boxId: 8, itemSlotType: 21 },
        { boxId: 11, itemSlotType: 22 },
      ],
    },
    ...overrides,
  };
}

function lastGameHeroEvent(overrides = {}) {
  return skillEvent({
    key: 'last-game-hero',
    skill: {
      uid: '1178745627869275',
      skillCid: 1002081,
      hitBoxList: [
        { boxId: 23, itemUid: '1178745627868583', itemSlotType: 22 },
        { boxId: 11, itemUid: '1178745627868576', itemSlotType: 11 },
        { itemUid: '1178745627868563', itemSlotType: 11 },
      ],
    },
    ...overrides,
  });
}

describe('Ethan monitor grid helpers', () => {
  it('creates a row-major 43 by 10 cell list', () => {
    const cells = createMonitorCells();

    expect(cells).toHaveLength(430);
    expect(cells[0]).toMatchObject({ id: 1, row: 1, column: 1 });
    expect(cells[9]).toMatchObject({ id: 10, row: 1, column: 10 });
    expect(cells[10]).toMatchObject({ id: 11, row: 2, column: 1 });
    expect(cells[429]).toMatchObject({ id: 430, row: 43, column: 10 });
  });

  it('parses two digit itemSlotType values as width and height', () => {
    expect(parseSlotType(11)).toEqual({ width: 1, height: 1, cells: 1, label: '1x1' });
    expect(parseSlotType(21)).toEqual({ width: 2, height: 1, cells: 2, label: '2x1' });
    expect(parseSlotType(22)).toEqual({ width: 2, height: 2, cells: 4, label: '2x2' });
    expect(parseSlotType(7)).toBeNull();
    expect(parseSlotType(20)).toBeNull();
  });

  it('infers minimum occupied cells from a known top-left placement sequence with holes', () => {
    const result = inferMinimumOccupiedCells({
      outlines: [
        { boxId: 1, row: 1, column: 1, width: 1, height: 1, cells: [1], label: '1x1' },
        { boxId: 2, row: 1, column: 2, width: 2, height: 2, cells: [2, 3, 12, 13], label: '2x2' },
        { boxId: 4, row: 1, column: 4, width: 1, height: 1, cells: [4], label: '1x1' },
        { boxId: 5, row: 1, column: 5, width: 2, height: 2, cells: [5, 6, 15, 16], label: '2x2' },
        { boxId: 21, row: 3, column: 1, width: 5, height: 1, cells: [21, 22, 23, 24, 25], label: '5x1' },
        { boxId: 26, row: 3, column: 6, width: 5, height: 1, cells: [26, 27, 28, 29, 30], label: '5x1' },
      ],
    });

    expect(result).toMatchObject({
      minTotalCells: 30,
      knownOutlineCellCount: 20,
      unknownBlockingCellCount: 10,
      order: [1, 2, 4, 5, 21, 26],
    });
    expect(result.holeCells).toEqual([]);
  });

  it('adds complete unknown blocker footprints when known outlines alone cannot explain a placement', () => {
    const result = inferMinimumOccupiedCells({
      outlines: [{
        boxId: 19,
        row: 2,
        column: 9,
        width: 2,
        height: 2,
        cells: [19, 20, 29, 30],
        label: '2x2',
      }],
    });

    expect(result).toMatchObject({
      minTotalCells: 22,
      knownOutlineCellCount: 4,
      unknownBlockingCellCount: 18,
      order: [19],
    });
    expect(result.unknownBlockingCells).not.toContain(21);
  });

  it('defaults cells before the bottom-right outline top-left as occupied', () => {
    const result = inferMinimumOccupiedCells({
      outlines: [{
        boxId: 88,
        row: 9,
        column: 8,
        width: 2,
        height: 2,
        cells: [88, 89, 98, 99],
        label: '2x2',
      }],
    });

    expect(result).toMatchObject({
      minTotalCells: 91,
      knownOutlineCellCount: 4,
      unknownBlockingCellCount: 87,
    });
    expect(result.unknownBlockingCells).toEqual(Array.from({ length: 87 }, (_, index) => index + 1));
  });

  it('materializes unknown blockers as complete item footprints', () => {
    const result = inferMinimumOccupiedCells({
      outlines: [
        { boxId: 2, width: 1, height: 2, cells: [2, 12], label: '1x2' },
        { boxId: 4, width: 2, height: 1, cells: [4, 5], label: '2x1' },
        { boxId: 6, width: 2, height: 1, cells: [6, 7], label: '2x1' },
        { boxId: 8, width: 1, height: 2, cells: [8, 18], label: '1x2' },
        { boxId: 11, width: 1, height: 1, cells: [11], label: '1x1' },
        { boxId: 13, width: 2, height: 2, cells: [13, 14, 23, 24], label: '2x2' },
        { boxId: 17, width: 1, height: 2, cells: [17, 27], label: '1x2' },
        { boxId: 19, width: 2, height: 2, cells: [19, 20, 29, 30], label: '2x2' },
        { boxId: 28, width: 1, height: 1, cells: [28], label: '1x1' },
        { boxId: 35, width: 4, height: 4, cells: [35, 36, 37, 38, 45, 46, 47, 48, 55, 56, 57, 58, 65, 66, 67, 68], label: '4x4' },
        { boxId: 41, width: 1, height: 1, cells: [41], label: '1x1' },
        { boxId: 53, width: 2, height: 1, cells: [53, 54], label: '2x1' },
      ],
    });

    expect(result).toMatchObject({
      minTotalCells: 60,
      knownOutlineCellCount: 39,
      unknownBlockingCellCount: 21,
      order: [2, 4, 6, 8, 11, 13, 17, 19, 28, 35, 41, 53],
    });
    expect(result.unknownBlockingCells).toEqual([
      1, 3, 9, 10, 15, 16, 21, 22, 25, 26, 31, 32, 33, 34, 39, 40, 42, 43, 49, 50, 52,
    ]);
  });

  it('applies hero skill 1002081 outlines and revealed types', () => {
    const state = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent());

    expect(state.gameUid).toBe('game-1');
    expect(state.revealedTypes).toEqual(['武器装备', '家居日用']);
    expect(state.outlines).toEqual([
      expect.objectContaining({ boxId: 1, width: 1, height: 1, label: '1x1', cells: [1] }),
      expect.objectContaining({ boxId: 9, width: 2, height: 1, label: '2x1', cells: [9, 10] }),
      expect.objectContaining({ boxId: 12, width: 2, height: 2, label: '2x2', cells: [12, 13, 22, 23] }),
    ]);
  });

  it('infers outline quality when quality reveal arrives before overlapping outline reveal', () => {
    const qualityState = applyMonitorEventToGridState(createEmptyMonitorGridState(), {
      key: 'quality-1',
      gameUid: 'game-1',
      skill: {
        uid: 'quality-skill-1',
        skillCid: 702,
        hitBoxList: [{ boxId: 1, itemQuility: 4, itemQuilityName: '紫' }],
      },
    });
    const state = applyMonitorEventToGridState(qualityState, {
      key: 'outline-1',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-skill-1',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 22 }],
      },
    });

    expect(state.qualityCells).toEqual([
      expect.objectContaining({ cell: 2, qualityId: 4, qualityName: '紫' }),
    ]);
    expect(state.outlines).toEqual([
      expect.objectContaining({ boxId: 1, cells: [1, 2, 11, 12], qualityName: '紫', qualityStatus: 'confirmed' }),
    ]);
  });

  it('adds full item hitBox entries with slot type as visible outlines', () => {
    const state = applyMonitorEventToGridState(createEmptyMonitorGridState(), {
      key: 'full-blue-item',
      gameUid: 'game-1',
      skill: {
        uid: 'full-blue-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemCid: 1033001,
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          itemPrice: 3851,
        }],
      },
    });

    expect(state.outlines).toEqual([
      expect.objectContaining({
        boxId: 26,
        cells: [26, 27, 36, 37],
        label: '2x2',
        qualityName: '蓝',
        qualityStatus: 'confirmed',
        price: 3851,
      }),
    ]);
  });

  it('infers outline quality when overlapping quality reveal arrives after outline reveal', () => {
    const outlineState = applyMonitorEventToGridState(createEmptyMonitorGridState(), {
      key: 'outline-1',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-skill-1',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 22 }],
      },
    });
    const state = applyMonitorEventToGridState(outlineState, {
      key: 'quality-1',
      gameUid: 'game-1',
      skill: {
        uid: 'quality-skill-1',
        skillCid: 702,
        hitBoxList: [{ boxId: 11, itemQuility: 5, itemQuilityName: '金' }],
      },
    });

    expect(state.outlines).toEqual([
      expect.objectContaining({ boxId: 1, cells: [1, 2, 11, 12], qualityName: '金', qualityStatus: 'confirmed' }),
    ]);
  });

  it('marks outline quality as conflicting when overlapping quality cells disagree', () => {
    const qualityState = applyMonitorEventToGridState(createEmptyMonitorGridState(), {
      key: 'quality-1',
      gameUid: 'game-1',
      skill: {
        uid: 'quality-skill-1',
        skillCid: 702,
        hitBoxList: [
          { boxId: 0, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 1, itemQuility: 5, itemQuilityName: '金' },
        ],
      },
    });
    const state = applyMonitorEventToGridState(qualityState, {
      key: 'outline-1',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-skill-1',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 22 }],
      },
    });

    expect(state.outlines[0]).toMatchObject({ qualityName: '紫/金', qualityStatus: 'conflict' });
  });

  it('falls back to reveal type ids when type names are not enriched', () => {
    const state = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent({
      skill: {
        uid: 'skill-type-ids',
        skillCid: 1002081,
        hitItemTypeList: [105, 108],
        hitBoxList: [{ boxId: 0, itemSlotType: 11 }],
      },
    }));

    expect(state.revealedTypes).toEqual(['105', '108']);
  });

  it('normalizes protocol zero-based box ids for display cells', () => {
    const state = applyMonitorEventToGridState(createEmptyMonitorGridState(), lastGameHeroEvent());

    expect(state.warnings).toEqual([]);
    expect(state.outlines).toEqual([
      expect.objectContaining({ protocolBoxId: 23, boxId: 24, width: 2, height: 2, cells: [24, 25, 34, 35] }),
      expect.objectContaining({ protocolBoxId: 11, boxId: 12, width: 1, height: 1, cells: [12] }),
      expect.objectContaining({ protocolBoxId: 0, boxId: 1, width: 1, height: 1, cells: [1] }),
    ]);
  });

  it('dedupes repeated events by key or skill uid', () => {
    const first = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent());
    const second = applyMonitorEventToGridState(first, skillEvent({ key: 'event-1' }));
    const third = applyMonitorEventToGridState(second, skillEvent({ key: 'event-2' }));

    expect(second.outlines).toHaveLength(3);
    expect(third.outlines).toHaveLength(3);
    expect(third.seenKeys).toEqual(['game-1:event-1', 'game-1:skill-1']);
  });

  it('merges repeated outline footprints from distinct events', () => {
    const first = applyMonitorEventToGridState(createEmptyMonitorGridState(), {
      key: 'outline-repeat-1',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-repeat-skill-1',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 13, itemSlotType: 23, itemQuility: 3, itemQuilityName: '蓝' }],
      },
    });
    const second = applyMonitorEventToGridState(first, {
      key: 'outline-repeat-2',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-repeat-skill-2',
        skillCid: 200022,
        hitBoxList: [{ boxId: 13, itemSlotType: 23, itemQuility: 3, itemQuilityName: '蓝', itemPrice: 3906 }],
      },
    });

    expect(second.outlines).toHaveLength(1);
    expect(second.outlines[0]).toMatchObject({
      boxId: 14,
      width: 2,
      height: 3,
      qualityName: '蓝',
      price: 3906,
    });
    expect(second.minimumOccupied.valid).toBe(true);
  });

  it('clears previous outlines when a new game uid arrives', () => {
    const first = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent());
    const second = applyMonitorEventToGridState(first, skillEvent({
      key: 'event-2',
      gameUid: 'game-2',
      skill: {
        uid: 'skill-2',
        skillCid: 1002081,
        hitItemTypeNames: ['交通工具'],
        hitBoxList: [{ boxId: 19, itemSlotType: 11 }],
      },
    }));

    expect(second.gameUid).toBe('game-2');
    expect(second.outlines).toHaveLength(1);
    expect(second.outlines[0]).toMatchObject({ boxId: 20, cells: [20] });
    expect(second.revealedTypes).toEqual(['交通工具']);
  });

  it('clears previous outlines when a new game starts with an aggregate event', () => {
    const first = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent());
    const second = applyMonitorEventToGridState(first, {
      type: 'skill',
      key: 'aggregate-1',
      gameUid: 'game-2',
      skill: {
        uid: 'aggregate-skill-1',
        skillCid: 200013,
        allHitItemAvgBoxIndex: 3.2,
      },
    });

    expect(second.gameUid).toBe('game-2');
    expect(second.outlines).toEqual([]);
    expect(second.qualityCells).toEqual([]);
    expect(second.minimumOccupied).toBe(null);
  });

  it('clears previous outlines when a new game reuses an event key or skill uid', () => {
    const first = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent());
    const second = applyMonitorEventToGridState(first, skillEvent({
      gameUid: 'game-2',
      skill: {
        uid: 'skill-1',
        skillCid: 1002081,
        hitItemTypeNames: ['交通工具'],
        hitBoxList: [{ boxId: 19, itemSlotType: 11 }],
      },
    }));

    expect(second.gameUid).toBe('game-2');
    expect(second.outlines).toHaveLength(1);
    expect(second.outlines[0]).toMatchObject({ boxId: 20, cells: [20] });
    expect(second.revealedTypes).toEqual(['交通工具']);
  });

  it('ignores unrelated skills', () => {
    const state = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent({
      skill: { skillCid: 702, hitBoxList: [{ boxId: 1 }] },
    }));

    expect(state.outlines).toEqual([]);
    expect(state.revealedTypes).toEqual([]);
  });

  it('records warnings for invalid or out-of-board placements', () => {
    const state = applyMonitorEventToGridState(createEmptyMonitorGridState(), skillEvent({
      skill: {
        uid: 'skill-invalid',
        skillCid: 1002081,
        hitBoxList: [
          { boxId: 430, itemSlotType: 11 },
          { boxId: 429, itemSlotType: 22 },
          { boxId: 5, itemSlotType: 20 },
        ],
      },
    }));

    expect(state.outlines).toEqual([]);
    expect(state.warnings).toHaveLength(3);
    expect(state.warnings.join(' ')).toContain('box 430');
    expect(state.warnings.join(' ')).toContain('box 429');
    expect(state.warnings.join(' ')).toContain('slot 20');
  });
});
