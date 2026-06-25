const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

const DEBUGGER_HISTORY_DIR = path.join('BKToolBox', 'min-cells-debugger-history');
const DEBUGGER_HISTORY_FILE = 'history.ndjson';
const DEBUGGER_HISTORY_SOURCE = 'tools-min-cells-debugger';

// Mirrors src/elsa/minimum-cells-debugger.js. A test catches drift from frontend constants.
const DEBUGGER_HISTORY_GRID_ROWS = 43;
const DEBUGGER_HISTORY_GRID_COLUMNS = 10;

class MinCellsDebuggerHistoryStore {
  constructor({ rootDir, now = () => new Date() } = {}) {
    this.documentsDir = rootDir || getDocumentsDir();
    this.rootDir = path.join(this.documentsDir, DEBUGGER_HISTORY_DIR);
    this.now = now;
    this.historyPath = path.join(this.rootDir, DEBUGGER_HISTORY_FILE);
  }

  recordEntry(entry) {
    const savedAt = this.now().toISOString();
    const normalized = normalizeMinCellsDebuggerHistoryEntry(entry, { savedAt });
    if (!normalized) {
      throw new Error('Invalid minimum cells debugger history entry');
    }

    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.appendFileSync(this.historyPath, `${JSON.stringify(normalized)}\n`, 'utf8');

    return {
      written: true,
      savedAt,
      outputPath: this.historyPath,
    };
  }
}

function normalizeMinCellsDebuggerHistoryEntry(entry, { savedAt = new Date().toISOString() } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.id !== 'string' || entry.id.trim() === '') return null;
  if (!isValidIsoDate(entry.createdAt)) return null;
  if (entry.version !== 1) return null;
  if (entry.grid?.rows !== DEBUGGER_HISTORY_GRID_ROWS) return null;
  if (entry.grid?.columns !== DEBUGGER_HISTORY_GRID_COLUMNS) return null;
  if (!Array.isArray(entry.outlines)) return null;
  if (!entry.outlines.every(isValidOutline)) return null;
  if (entry.result !== null && (!entry.result || typeof entry.result !== 'object' || Array.isArray(entry.result))) return null;
  if (typeof entry.summary !== 'string') return null;
  if (!isValidIsoDate(savedAt)) return null;

  return {
    id: entry.id,
    createdAt: new Date(entry.createdAt).toISOString(),
    version: 1,
    grid: {
      rows: DEBUGGER_HISTORY_GRID_ROWS,
      columns: DEBUGGER_HISTORY_GRID_COLUMNS,
    },
    outlines: entry.outlines.map((outline) => ({
      boxId: outline.boxId,
      width: outline.width,
      height: outline.height,
      cells: [...outline.cells],
    })),
    result: entry.result === null ? null : { ...entry.result },
    summary: entry.summary,
    savedAt: new Date(savedAt).toISOString(),
    source: DEBUGGER_HISTORY_SOURCE,
  };
}

function isValidOutline(outline) {
  return outline &&
    typeof outline === 'object' &&
    !Array.isArray(outline) &&
    Number.isFinite(outline.boxId) &&
    Number.isFinite(outline.width) &&
    Number.isFinite(outline.height) &&
    Array.isArray(outline.cells) &&
    outline.cells.every((cell) => Number.isFinite(cell));
}

function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

module.exports = {
  MinCellsDebuggerHistoryStore,
  normalizeMinCellsDebuggerHistoryEntry,
  DEBUGGER_HISTORY_GRID_ROWS,
  DEBUGGER_HISTORY_GRID_COLUMNS,
};
