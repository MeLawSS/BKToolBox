// src/elsa/minimum-cells-debugger.js

export const DEBUGGER_GRID_ROWS = 43;
export const DEBUGGER_GRID_COLUMNS = 10;
export const HISTORY_STORAGE_KEY = 'bidking-tools-min-cells-debugger-history:v1';
export const MAX_HISTORY_ENTRIES = 100;

/**
 * Convert zero-based (row, col) to row-major boxId (1-based).
 */
export function cellToBoxId(row, col, columns = DEBUGGER_GRID_COLUMNS) {
  return row * columns + col + 1;
}

/**
 * Convert a 1-based boxId to zero-based { row, col }.
 */
export function boxIdToRowCol(boxId, columns = DEBUGGER_GRID_COLUMNS) {
  const idx = boxId - 1;
  return { row: Math.floor(idx / columns), col: idx % columns };
}

/**
 * Normalize a drag rectangle so (row1,col1) is top-left and (row2,col2) is bottom-right.
 * Input coordinates may be in any drag direction.
 */
export function normalizeRect(row1, col1, row2, col2) {
  const topRow = Math.min(row1, row2);
  const leftCol = Math.min(col1, col2);
  const bottomRow = Math.max(row1, row2);
  const rightCol = Math.max(col1, col2);
  return { topRow, leftCol, bottomRow, rightCol };
}

/**
 * Expand a boxId/width/height into the array of occupied cell numbers.
 */
export function expandOutlineCells(boxId, width, height, columns = DEBUGGER_GRID_COLUMNS) {
  const { row, col } = boxIdToRowCol(boxId, columns);
  const cells = [];
  for (let r = row; r < row + height; r += 1) {
    for (let c = col; c < col + width; c += 1) {
      cells.push(cellToBoxId(r, c, columns));
    }
  }
  return cells;
}

/**
 * Convert a normalized drag rectangle into a debugger outline object.
 */
export function rectToOutline(topRow, leftCol, bottomRow, rightCol, columns = DEBUGGER_GRID_COLUMNS) {
  const boxId = cellToBoxId(topRow, leftCol, columns);
  const width = rightCol - leftCol + 1;
  const height = bottomRow - topRow + 1;
  const cells = expandOutlineCells(boxId, width, height, columns);
  return { boxId, width, height, cells };
}

/**
 * Return the first existing outline that overlaps with the given cells, or null.
 */
export function detectOverlap(cells, existingOutlines) {
  const cellSet = new Set(cells);
  for (const outline of existingOutlines) {
    for (const cell of outline.cells) {
      if (cellSet.has(cell)) return outline;
    }
  }
  return null;
}

/**
 * Generate a unique runtime ID for UI keying.
 */
let _nextId = 1;
export function generateRuntimeId() {
  return `outline-${Date.now()}-${_nextId++}`;
}

/**
 * Build a human-readable summary string for a history entry.
 */
export function buildResultSummary(outlines, result) {
  if (!result) return '0 / 0 / 0';
  const itemCount = outlines.length;
  const knownCells = result.knownOutlineCellCount ?? 0;
  const minCells = result.minTotalCells ?? 0;
  return `${itemCount} / ${knownCells} / ${minCells}`;
}

/**
 * Create a serializable history entry from outlines and algorithm result.
 */
export function createHistoryEntry(outlines, result) {
  return {
    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    version: 1,
    grid: { rows: DEBUGGER_GRID_ROWS, columns: DEBUGGER_GRID_COLUMNS },
    outlines: outlines.map((o) => ({
      boxId: o.boxId,
      width: o.width,
      height: o.height,
      cells: [...o.cells],
    })),
    result: result ? { ...result } : null,
    summary: buildResultSummary(outlines, result),
  };
}

/**
 * Serialize history array to a JSON string. Returns null on failure.
 */
export function serializeHistory(history) {
  try {
    return JSON.stringify(history);
  } catch (_err) {
    return null;
  }
}

/**
 * Deserialize a JSON string into a history array. Returns [] on any failure.
 */
export function deserializeHistory(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        Array.isArray(entry.outlines) &&
        typeof entry.createdAt === 'string' &&
        entry.outlines.every(
          (o) =>
            o &&
            typeof o.boxId === 'number' &&
            typeof o.width === 'number' &&
            typeof o.height === 'number' &&
            Array.isArray(o.cells),
        ),
    );
  } catch (_err) {
    return [];
  }
}

/**
 * Prune history to maxEntries, keeping newest first. Returns a new array.
 */
export function pruneHistory(history, maxEntries = MAX_HISTORY_ENTRIES) {
  if (!Array.isArray(history)) return [];
  return history.slice(0, maxEntries);
}
