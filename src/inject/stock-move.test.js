import { describe, expect, it } from 'vitest';
import {
  sortMovableItems,
  findFirstPlacement,
  buildMoveArgs,
} from './stock-move.js';

describe('sortMovableItems', () => {
  it('places larger items first, then keeps lower pos first for ties', () => {
    const rows = [
      { itemUid: 'b', boxCount: 1, pos: 9 },
      { itemUid: 'c', boxCount: 4, pos: 8 },
      { itemUid: 'a', boxCount: 4, pos: 3 },
    ];

    expect(sortMovableItems(rows).map((item) => item.itemUid)).toEqual(['a', 'c', 'b']);
  });
});

describe('findFirstPlacement', () => {
  const source = {
    stockId: 1,
    width: 4,
  };

  const target = {
    stockId: 2,
    width: 3,
    cells: [
      { boxId: 0, x: 0, y: 0 },
      { boxId: 1, x: 1, y: 0 },
      { boxId: 2, x: 2, y: 0 },
      { boxId: 3, x: 0, y: 1 },
      { boxId: 4, x: 1, y: 1 },
      { boxId: 5, x: 2, y: 1 },
    ],
    items: [
      { itemUid: 'occupied', boxIds: [0] },
    ],
  };

  it('finds the first row-major anchor that fits the shape', () => {
    const placement = findFirstPlacement(target, source, {
      pos: 20,
      boxIds: [20, 21, 24, 25],
    });

    expect(placement).toEqual({ newSlot: 1, boxIds: [1, 2, 4, 5] });
  });

  it('skips row-wrapping anchors for horizontal shapes', () => {
    const targetWithBlockedFirstRow = {
      stockId: 2,
      width: 3,
      cells: [
        { boxId: 0, x: 0, y: 0 },
        { boxId: 1, x: 1, y: 0 },
        { boxId: 2, x: 2, y: 0 },
        { boxId: 3, x: 0, y: 1 },
        { boxId: 4, x: 1, y: 1 },
        { boxId: 5, x: 2, y: 1 },
      ],
      items: [
        { itemUid: 'occupied-a', boxIds: [0] },
        { itemUid: 'occupied-b', boxIds: [1] },
      ],
    };

    const placement = findFirstPlacement(targetWithBlockedFirstRow, source, {
      pos: 8,
      boxIds: [8, 9],
    });

    expect(placement).toEqual({ newSlot: 3, boxIds: [3, 4] });
  });

  it('returns null when no placement exists', () => {
    const placement = findFirstPlacement(target, source, {
      pos: 20,
      boxIds: [20, 21, 22, 24, 25, 26],
    });

    expect(placement).toBeNull();
  });
});

describe('buildMoveArgs', () => {
  it('maps source item + placement to MoveStockItem args', () => {
    expect(buildMoveArgs({
      sourceItem: { stockId: 1, pos: 24, rotate: true },
      targetStockId: 9,
      placement: { newSlot: 13 },
    })).toEqual({
      oldStockId: 1,
      oldSlot: 24,
      newStockId: 9,
      newSlot: 13,
      isRotate: true,
    });
  });
});
