// src/elsa/minimum-cells-debugger.test.js
import { describe, expect, it } from 'vitest';
import {
  cellToBoxId,
  boxIdToRowCol,
  normalizeRect,
  expandOutlineCells,
  rectToOutline,
  detectOverlap,
  generateRuntimeId,
  createHistoryEntry,
  serializeHistory,
  deserializeHistory,
  pruneHistory,
  buildResultSummary,
  DEBUGGER_GRID_ROWS,
  DEBUGGER_GRID_COLUMNS,
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ENTRIES,
} from './minimum-cells-debugger.js';

describe('cellToBoxId', () => {
  it('maps (0,0) to boxId 1', () => {
    expect(cellToBoxId(0, 0, 10)).toBe(1);
  });

  it('maps (0,9) to boxId 10', () => {
    expect(cellToBoxId(0, 9, 10)).toBe(10);
  });

  it('maps (1,0) to boxId 11 (next row)', () => {
    expect(cellToBoxId(1, 0, 10)).toBe(11);
  });

  it('maps (42,9) to boxId 430 (last cell)', () => {
    expect(cellToBoxId(42, 9, 10)).toBe(430);
  });

  it('uses default columns when not specified', () => {
    expect(cellToBoxId(0, 0)).toBe(1);
    expect(cellToBoxId(0, 9)).toBe(10);
  });
});

describe('boxIdToRowCol', () => {
  it('maps boxId 1 to (0,0)', () => {
    expect(boxIdToRowCol(1, 10)).toEqual({ row: 0, col: 0 });
  });

  it('maps boxId 10 to (0,9)', () => {
    expect(boxIdToRowCol(10, 10)).toEqual({ row: 0, col: 9 });
  });

  it('maps boxId 11 to (1,0)', () => {
    expect(boxIdToRowCol(11, 10)).toEqual({ row: 1, col: 0 });
  });

  it('maps boxId 430 to (42,9)', () => {
    expect(boxIdToRowCol(430, 10)).toEqual({ row: 42, col: 9 });
  });
});

describe('normalizeRect', () => {
  it('passes through an already-normalized rect', () => {
    expect(normalizeRect(0, 0, 2, 3)).toEqual({ topRow: 0, leftCol: 0, bottomRow: 2, rightCol: 3 });
  });

  it('reverses a bottom-right to top-left drag', () => {
    expect(normalizeRect(5, 8, 2, 3)).toEqual({ topRow: 2, leftCol: 3, bottomRow: 5, rightCol: 8 });
  });

  it('reverses a top-right to bottom-left drag', () => {
    expect(normalizeRect(0, 5, 3, 1)).toEqual({ topRow: 0, leftCol: 1, bottomRow: 3, rightCol: 5 });
  });

  it('handles single-cell drag (start == end)', () => {
    expect(normalizeRect(4, 4, 4, 4)).toEqual({ topRow: 4, leftCol: 4, bottomRow: 4, rightCol: 4 });
  });
});

describe('expandOutlineCells', () => {
  it('expands a 1x1 outline at boxId 1', () => {
    expect(expandOutlineCells(1, 1, 1, 10)).toEqual([1]);
  });

  it('expands a 2x3 outline at boxId 1 (10 cols)', () => {
    // rows 0-2, cols 0-1: cells 1,2, 11,12, 21,22
    expect(expandOutlineCells(1, 2, 3, 10)).toEqual([1, 2, 11, 12, 21, 22]);
  });

  it('expands a 3x2 outline at boxId 12 (10 cols)', () => {
    // row 1 col 1 = boxId 12, width=3 height=2
    // cells: 12,13,14, 22,23,24
    expect(expandOutlineCells(12, 3, 2, 10)).toEqual([12, 13, 14, 22, 23, 24]);
  });

  it('wraps correctly at column boundary for multi-row outlines', () => {
    // boxId 9 at (0,8), width=2 height=2: cells 9,10, 19,20
    expect(expandOutlineCells(9, 2, 2, 10)).toEqual([9, 10, 19, 20]);
  });
});

describe('rectToOutline', () => {
  it('converts a single-cell rect', () => {
    const outline = rectToOutline(0, 0, 0, 0, 10);
    expect(outline.boxId).toBe(1);
    expect(outline.width).toBe(1);
    expect(outline.height).toBe(1);
    expect(outline.cells).toEqual([1]);
  });

  it('converts a 2x2 rect at top-left', () => {
    const outline = rectToOutline(0, 0, 1, 1, 10);
    expect(outline.boxId).toBe(1);
    expect(outline.width).toBe(2);
    expect(outline.height).toBe(2);
    expect(outline.cells).toEqual([1, 2, 11, 12]);
  });

  it('converts a rect not at origin', () => {
    const outline = rectToOutline(5, 3, 7, 6, 10);
    // row 5 col 3 = 5*10+3+1 = 54
    expect(outline.boxId).toBe(54);
    expect(outline.width).toBe(4);
    expect(outline.height).toBe(3);
  });
});

describe('detectOverlap', () => {
  it('returns null when no overlap', () => {
    const existing = [
      { id: 'a', boxId: 1, width: 2, height: 2, cells: [1, 2, 11, 12] },
    ];
    expect(detectOverlap([21, 22, 31, 32], existing)).toBeNull();
  });

  it('returns the overlapping outline', () => {
    const existing = [
      { id: 'a', boxId: 1, width: 2, height: 2, cells: [1, 2, 11, 12] },
    ];
    expect(detectOverlap([2, 3, 12, 13], existing)).toBe(existing[0]);
  });

  it('returns null for empty existing outlines', () => {
    expect(detectOverlap([1, 2], [])).toBeNull();
  });
});

describe('generateRuntimeId', () => {
  it('returns a string starting with outline-', () => {
    expect(generateRuntimeId()).toMatch(/^outline-/);
  });

  it('returns unique ids on successive calls', () => {
    const a = generateRuntimeId();
    const b = generateRuntimeId();
    expect(a).not.toBe(b);
  });
});

describe('buildResultSummary', () => {
  it('handles null result', () => {
    expect(buildResultSummary([], null)).toBe('0 / 0 / 0');
  });

  it('formats a valid result', () => {
    const result = { valid: true, minTotalCells: 19, knownOutlineCellCount: 14, unknownBlockingCellCount: 5 };
    expect(buildResultSummary([{ boxId: 1 }], result)).toBe('1 / 14 / 19');
  });
});

describe('createHistoryEntry', () => {
  it('creates a valid entry with all required fields', () => {
    const outlines = [{ boxId: 12, width: 2, height: 3, cells: [12, 13, 22, 23, 32, 33] }];
    const result = { valid: true, minTotalCells: 19, knownOutlineCellCount: 6, unknownBlockingCellCount: 5, unknownBlockingCells: [1, 2], order: [12], holeCells: [] };
    const entry = createHistoryEntry(outlines, result);
    expect(entry.id).toMatch(/^hist-/);
    expect(entry.version).toBe(1);
    expect(entry.grid).toEqual({ rows: 43, columns: 10 });
    expect(entry.outlines).toHaveLength(1);
    expect(entry.outlines[0].boxId).toBe(12);
    expect(entry.outlines[0].cells).toEqual([12, 13, 22, 23, 32, 33]);
    expect(entry.result.valid).toBe(true);
    expect(typeof entry.createdAt).toBe('string');
    expect(entry.summary).toBe('1 / 6 / 19');
  });

  it('handles null result', () => {
    const entry = createHistoryEntry([], null);
    expect(entry.result).toBeNull();
    expect(entry.summary).toBe('0 / 0 / 0');
  });

  it('copies cells arrays (does not share references)', () => {
    const cells = [1, 2, 3];
    const outlines = [{ boxId: 1, width: 1, height: 1, cells }];
    const entry = createHistoryEntry(outlines, { valid: true, minTotalCells: 3 });
    cells.push(99);
    expect(entry.outlines[0].cells).toEqual([1, 2, 3]);
  });
});

describe('serializeHistory / deserializeHistory', () => {
  it('round-trips a history array', () => {
    const history = [
      { id: 'h1', createdAt: '2025-01-01T00:00:00Z', version: 1, grid: { rows: 43, columns: 10 }, outlines: [], result: null, summary: 'test' },
    ];
    const raw = serializeHistory(history);
    expect(typeof raw).toBe('string');
    const restored = deserializeHistory(raw);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('h1');
  });

  it('returns [] for null input', () => {
    expect(deserializeHistory(null)).toEqual([]);
  });

  it('returns [] for invalid JSON', () => {
    expect(deserializeHistory('not json')).toEqual([]);
  });

  it('returns [] for non-array parsed value', () => {
    expect(deserializeHistory('{}')).toEqual([]);
  });

  it('filters out entries missing required fields', () => {
    const history = [
      { id: 'good', createdAt: 'ts', outlines: [] },
      { noId: true },
      { id: 'bad', createdAt: 'ts' },       // missing outlines array
      { id: 'good2', createdAt: 'ts', outlines: [{ boxId: 1 }] },
    ];
    const raw = serializeHistory(history);
    const restored = deserializeHistory(raw);
    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('good');
    expect(restored[1].id).toBe('good2');
  });

  it('returns [] on serialization failure (circular refs)', () => {
    const obj = {};
    obj.self = obj;
    expect(serializeHistory([obj])).toBeNull();
  });
});

describe('pruneHistory', () => {
  it('returns empty array for non-array input', () => {
    expect(pruneHistory(null)).toEqual([]);
  });

  it('keeps all entries when under cap', () => {
    const history = [{ id: 'a' }, { id: 'b' }];
    expect(pruneHistory(history, 5)).toHaveLength(2);
  });

  it('truncates to maxEntries keeping newest first', () => {
    const history = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const pruned = pruneHistory(history, 2);
    expect(pruned).toHaveLength(2);
    expect(pruned[0].id).toBe('a');
    expect(pruned[1].id).toBe('b');
  });
});

describe('constants', () => {
  it('has correct grid dimensions', () => {
    expect(DEBUGGER_GRID_ROWS).toBe(43);
    expect(DEBUGGER_GRID_COLUMNS).toBe(10);
  });

  it('has correct storage key', () => {
    expect(HISTORY_STORAGE_KEY).toBe('bidking-tools-min-cells-debugger-history:v1');
  });

  it('has correct max history entries', () => {
    expect(MAX_HISTORY_ENTRIES).toBe(100);
  });
});
