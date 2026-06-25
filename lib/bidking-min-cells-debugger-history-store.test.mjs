import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  DEBUGGER_GRID_ROWS,
  DEBUGGER_GRID_COLUMNS,
} from '../src/elsa/minimum-cells-debugger.js';

const require = createRequire(import.meta.url);
const {
  MinCellsDebuggerHistoryStore,
  normalizeMinCellsDebuggerHistoryEntry,
  DEBUGGER_HISTORY_GRID_ROWS,
  DEBUGGER_HISTORY_GRID_COLUMNS,
} = require('./bidking-min-cells-debugger-history-store.js');

function createValidEntry(overrides = {}) {
  return {
    id: 'hist-test-1',
    createdAt: '2026-06-25T06:00:00.000Z',
    version: 1,
    grid: { rows: 43, columns: 10 },
    outlines: [
      { boxId: 12, width: 2, height: 3, cells: [12, 13, 22, 23, 32, 33] },
    ],
    result: {
      valid: true,
      minTotalCells: 19,
      knownOutlineCellCount: 6,
      unknownBlockingCellCount: 5,
      unknownBlockingCells: [41, 42],
      order: [12],
      holeCells: [],
    },
    summary: '1 / 6 / 19',
    ...overrides,
  };
}

async function withTempStore(testFn) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'min-cells-debugger-history-'));
  try {
    const store = new MinCellsDebuggerHistoryStore({
      rootDir,
      now: () => new Date('2026-06-25T06:00:01.234Z'),
    });
    await testFn(store, rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe('MinCellsDebuggerHistoryStore', () => {
  it('keeps mirrored grid constants aligned with the frontend debugger grid', () => {
    expect(DEBUGGER_HISTORY_GRID_ROWS).toBe(DEBUGGER_GRID_ROWS);
    expect(DEBUGGER_HISTORY_GRID_COLUMNS).toBe(DEBUGGER_GRID_COLUMNS);
  });

  it('normalizes a valid debugger history entry with savedAt and source', () => {
    const normalized = normalizeMinCellsDebuggerHistoryEntry(
      createValidEntry(),
      { savedAt: '2026-06-25T06:00:01.234Z' },
    );

    expect(normalized).toMatchObject({
      id: 'hist-test-1',
      version: 1,
      grid: { rows: 43, columns: 10 },
      savedAt: '2026-06-25T06:00:01.234Z',
      source: 'tools-min-cells-debugger',
    });
    expect(normalized.outlines[0].cells).toEqual([12, 13, 22, 23, 32, 33]);
  });

  it('appends one JSON line for a valid entry', async () => {
    await withTempStore(async (store) => {
      const result = store.recordEntry(createValidEntry());

      expect(result).toMatchObject({
        written: true,
        savedAt: '2026-06-25T06:00:01.234Z',
      });
      expect(result.outputPath.endsWith(path.join('min-cells-debugger-history', 'history.ndjson'))).toBe(true);

      const text = await readFile(result.outputPath, 'utf8');
      const lines = text.trim().split('\n');
      expect(lines).toHaveLength(1);

      const row = JSON.parse(lines[0]);
      expect(row.id).toBe('hist-test-1');
      expect(row.savedAt).toBe('2026-06-25T06:00:01.234Z');
      expect(row.source).toBe('tools-min-cells-debugger');
    });
  });

  it('appends multiple entries without rewriting previous rows', async () => {
    await withTempStore(async (store) => {
      const first = store.recordEntry(createValidEntry({ id: 'hist-test-1' }));
      store.recordEntry(createValidEntry({ id: 'hist-test-2' }));

      const text = await readFile(first.outputPath, 'utf8');
      const rows = text.trim().split('\n').map((line) => JSON.parse(line));
      expect(rows.map((row) => row.id)).toEqual(['hist-test-1', 'hist-test-2']);
    });
  });

  it('rejects malformed entries without writing a row', async () => {
    await withTempStore(async (store, rootDir) => {
      expect(() => store.recordEntry(createValidEntry({
        grid: { rows: 42, columns: 10 },
      }))).toThrow('Invalid minimum cells debugger history entry');

      await expect(readFile(path.join(rootDir, 'history.ndjson'), 'utf8'))
        .rejects
        .toMatchObject({ code: 'ENOENT' });
    });
  });
});
