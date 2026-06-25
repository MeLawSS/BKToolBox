# Tools V2 Minimum Cells Debugger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new debug-focused `panel` tab under the existing `Tools` page for testing the V2 minimum total cells algorithm via a 43×10 drag-to-draw matrix editor with local calculation history.

**Architecture:** Three new files form the debugger subsystem — pure helpers (`minimum-cells-debugger.js`), a Vue composable (`useMinimumCellsDebugger.js`), and a panel component (`ToolsMinimumCellsDebuggerPanel.vue`). The existing `App.vue` tabs array gets one new entry, and `messages.js` gets two-locale string coverage for all debugger-facing copy.

**Tech Stack:** Vue 3 (Composition API, `<script setup>`), Vitest + happy-dom, CSS Grid, localStorage

## Global Constraints

- Grid dimensions: 43 rows × 10 columns (430 cells), boxId row-major from 1
- Algorithm entry point: `inferMinimumOccupiedCellsV2` from `src/ethan/monitor-grid.js`
- Persistence key: `bidking-tools-min-cells-debugger-history:v1`, NOT in `TOOLS_PAGE_CACHE_KEYS`
- Max 100 history entries; newest first; oldest pruned on overflow
- All user-facing strings in both `zh-CN` and `en-US` — no raw i18n keys visible
- Panel tab inserted after Elsa/Ethan/Ahmed, before solver tabs
- Elsa remains default tab; debugger lazy-mounted like other non-Elsa panels
- Do not modify Ethan monitor state machine, SSE flow, solver tabs, or `/run` endpoints
- `cells` arrays must be present in the payload passed to `inferMinimumOccupiedCellsV2`
- No keyboard-only matrix editing in this round
- CSS Grid DOM rendering, not `<canvas>`
- Existing baseline test failures are pre-existing — do not broaden the failure set

---

### Task 1: Pure helper module

**Files:**
- Create: `src/elsa/minimum-cells-debugger.js`
- Create: `src/elsa/minimum-cells-debugger.test.js`

**Interfaces:**
- Consumes: nothing (zero dependencies)
- Produces: `DEBUGGER_GRID_ROWS`, `DEBUGGER_GRID_COLUMNS`, `HISTORY_STORAGE_KEY`, `MAX_HISTORY_ENTRIES`, `cellToBoxId`, `boxIdToRowCol`, `normalizeRect`, `expandOutlineCells`, `rectToOutline`, `detectOverlap`, `generateRuntimeId`, `createHistoryEntry`, `serializeHistory`, `deserializeHistory`, `pruneHistory`, `buildResultSummary`

- [ ] **Step 1: Write the pure helper module**

```js
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
  if (!result) return '0 items / null result';
  const itemCount = outlines.length;
  const knownCells = result.knownOutlineCellCount ?? 0;
  const minCells = result.minTotalCells ?? 0;
  return `${itemCount} items / ${knownCells} known cells / min ${minCells}`;
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
        typeof entry.createdAt === 'string',
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
```

- [ ] **Step 2: Write tests for the pure helper module**

```js
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
    expect(buildResultSummary([], null)).toBe('0 items / null result');
  });

  it('formats a valid result', () => {
    const result = { valid: true, minTotalCells: 19, knownOutlineCellCount: 14, unknownBlockingCellCount: 5 };
    expect(buildResultSummary([{ boxId: 1 }], result)).toBe('1 items / 14 known cells / min 19');
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
    expect(entry.summary).toContain('1 items');
  });

  it('handles null result', () => {
    const entry = createHistoryEntry([], null);
    expect(entry.result).toBeNull();
    expect(entry.summary).toBe('0 items / null result');
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
```

- [ ] **Step 3: Run pure helper tests — expect all pass**

Run: `npx vitest run src/elsa/minimum-cells-debugger.test.js`
Expected: All tests pass (should be ~30 tests)

- [ ] **Step 4: Commit**

```bash
git add src/elsa/minimum-cells-debugger.js src/elsa/minimum-cells-debugger.test.js
git commit -m "feat: add minimum cells debugger pure helpers"
```

---

### Task 2: Locale strings

**Files:**
- Modify: `src/shared/messages.js` — add debugger keys to both `zh-CN` and `en-US`

**Interfaces:**
- Consumes: nothing
- Produces: `tools.tabs.minCellsDebugger`, `tools.debugger.*` keys consumed by Tasks 4 (panel component)

- [ ] **Step 1: Add locale strings**

In `src/shared/messages.js`, locate the `tools.tabs` block (around line 416) and add the tab label. Then add a new `tools.debugger` block.

Inside `'zh-CN'` → `tools` → `tabs`, after `ahmedCalculator`:

```js
minCellsDebugger: 'V2 最小格数 · 调试器',
```

Inside `'zh-CN'` → `tools`, add after the `hero` block (before the closing `},` of tools):

```js
debugger: {
  title: 'V2 最小格数调试器',
  subtitle: '拖拽选取矩形轮廓，运行 V2 算法并查看结果与历史记录。',
  boardAria: 'V2 最小格数调试矩阵',
  calculate: '计算',
  clear: '清空',
  delete: '删除',
  noOutlines: '尚无轮廓。请在矩阵上拖拽创建矩形轮廓。',
  outlineLabel: '轮廓 {boxId}',
  outlineDims: '{width}×{height}',
  outlineCells: '{count} 格',
  conflict: '所选区域与已有轮廓重叠，请调整选区。',
  emptyMatrix: '请先添加至少一个轮廓再运行计算。',
  noResult: '点击计算查看 V2 算法结果。',
  nullResult: '算法返回 null — 可能没有有效轮廓。',
  historyTitle: '历史记录',
  historyEmpty: '暂无计算历史。',
  historySummary: '{count} 项 / {known} 已知格 / 最少 {min}',
  restore: '恢复',
  recalculate: '重新计算',
  storageError: '保存历史记录失败，当前结果仍有效。',
  resultValid: '有效',
  resultInvalid: '无效',
  resultMinCells: '最少格数',
  resultKnownCells: '已知轮廓格数',
  resultUnknownBlockers: '未知阻挡格数',
  resultUnknownBlockersList: '未知阻挡格列表',
  resultOrder: '放置顺序',
  resultHoles: '空洞格',
  resultOutlinePayload: '算法输入轮廓',
  resultDetails: '详细调试输出',
},
```

Inside `'en-US'` → `tools` → `tabs`, after `ahmedCalculator`:

```js
minCellsDebugger: 'V2 Min Cells · Debugger',
```

Inside `'en-US'` → `tools`, add after the `hero` block:

```js
debugger: {
  title: 'V2 Minimum Cells Debugger',
  subtitle: 'Drag to create rectangular outlines, run the V2 algorithm, and inspect results and history.',
  boardAria: 'V2 minimum cells debug board',
  calculate: 'Calculate',
  clear: 'Clear',
  delete: 'Delete',
  noOutlines: 'No outlines yet. Drag on the matrix to create rectangular outlines.',
  outlineLabel: 'Outline {boxId}',
  outlineDims: '{width}×{height}',
  outlineCells: '{count} cells',
  conflict: 'Selection overlaps an existing outline. Adjust the selection.',
  emptyMatrix: 'Add at least one outline before calculating.',
  noResult: 'Click Calculate to run the V2 algorithm.',
  nullResult: 'Algorithm returned null — no valid outlines.',
  historyTitle: 'History',
  historyEmpty: 'No calculation history.',
  historySummary: '{count} items / {known} known cells / min {min}',
  restore: 'Restore',
  recalculate: 'Recalculate',
  storageError: 'Failed to save history. Current result remains valid.',
  resultValid: 'Valid',
  resultInvalid: 'Invalid',
  resultMinCells: 'Min total cells',
  resultKnownCells: 'Known outline cells',
  resultUnknownBlockers: 'Unknown blockers',
  resultUnknownBlockersList: 'Unknown blocker cells',
  resultOrder: 'Placement order',
  resultHoles: 'Hole cells',
  resultOutlinePayload: 'Algorithm input outlines',
  resultDetails: 'Detailed debug output',
},
```

- [ ] **Step 2: Verify locale strings exist in built output (quick grep)**

Run: `node -e "const m = require('./src/shared/messages.js'); console.log(m.messages['zh-CN'].tools.tabs.minCellsDebugger); console.log(m.messages['en-US'].tools.debugger.title);"`
Expected: prints both strings without errors

Note: if `messages.js` uses ES module syntax, run instead:
`node --input-type=module -e "import { messages } from './src/shared/messages.js'; console.log(messages['zh-CN'].tools.tabs.minCellsDebugger);"`

- [ ] **Step 3: Commit**

```bash
git add src/shared/messages.js
git commit -m "feat: add debugger locale strings for zh-CN and en-US"
```

---

### Task 3: Stateful composable

**Files:**
- Create: `src/elsa/useMinimumCellsDebugger.js`

**Interfaces:**
- Consumes: `cellToBoxId`, `boxIdToRowCol`, `normalizeRect`, `expandOutlineCells`, `rectToOutline`, `detectOverlap`, `generateRuntimeId`, `createHistoryEntry`, `serializeHistory`, `deserializeHistory`, `pruneHistory`, `buildResultSummary`, `HISTORY_STORAGE_KEY`, `MAX_HISTORY_ENTRIES` from Task 1; `inferMinimumOccupiedCellsV2` from `src/ethan/monitor-grid.js`
- Produces: `useMinimumCellsDebugger()` → `{ outlines, selectedOutlineId, dragState, result, history, validationMessage, storageError, addOutlineFromDrag, deleteOutline, clearMatrix, selectOutline, calculate, restoreHistoryEntry, recalculateHistoryEntry, isConflictingDrag, getOccupiedCellSet, getAllCells }`

- [ ] **Step 1: Write the composable**

```js
// src/elsa/useMinimumCellsDebugger.js
import { computed, ref } from 'vue';
import { inferMinimumOccupiedCellsV2 } from '../ethan/monitor-grid.js';
import {
  DEBUGGER_GRID_COLUMNS,
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ENTRIES,
  normalizeRect,
  rectToOutline,
  detectOverlap,
  generateRuntimeId,
  createHistoryEntry,
  serializeHistory,
  deserializeHistory,
  pruneHistory,
} from './minimum-cells-debugger.js';

export function useMinimumCellsDebugger() {
  // ── State ──
  const outlines = ref([]);
  const selectedOutlineId = ref(null);
  const dragState = ref(null); // { startRow, startCol, currentRow, currentCol } | null
  const result = ref(null);
  const history = ref([]);
  const validationMessage = ref('');
  const storageError = ref('');

  // ── Derived ──
  function buildOccupiedCellSet(outlineList) {
    const set = new Set();
    for (const o of outlineList) {
      for (const c of o.cells) {
        set.add(c);
      }
    }
    return set;
  }

  const occupiedCellSet = computed(() => buildOccupiedCellSet(outlines.value));

  // ── Drag helpers ──
  function isConflictingDrag(rawStartRow, rawStartCol, rawEndRow, rawEndCol) {
    const { topRow, leftCol, bottomRow, rightCol } = normalizeRect(rawStartRow, rawStartCol, rawEndRow, rawEndCol);
    const draft = rectToOutline(topRow, leftCol, bottomRow, rightCol, DEBUGGER_GRID_COLUMNS);
    return detectOverlap(draft.cells, outlines.value) !== null;
  }

  function addOutlineFromDrag(rawStartRow, rawStartCol, rawEndRow, rawEndCol) {
    const { topRow, leftCol, bottomRow, rightCol } = normalizeRect(rawStartRow, rawStartCol, rawEndRow, rawEndCol);
    const base = rectToOutline(topRow, leftCol, bottomRow, rightCol, DEBUGGER_GRID_COLUMNS);

    if (detectOverlap(base.cells, outlines.value)) {
      validationMessage.value = 'debugger.conflict';
      return false;
    }

    const outline = {
      id: generateRuntimeId(),
      boxId: base.boxId,
      width: base.width,
      height: base.height,
      cells: base.cells,
    };

    outlines.value = [...outlines.value, outline];
    validationMessage.value = '';
    return true;
  }

  // ── Outline management ──
  function deleteOutline(id) {
    outlines.value = outlines.value.filter((o) => o.id !== id);
    if (selectedOutlineId.value === id) {
      selectedOutlineId.value = null;
    }
    result.value = null;
    validationMessage.value = '';
  }

  function selectOutline(id) {
    selectedOutlineId.value = selectedOutlineId.value === id ? null : id;
  }

  function clearMatrix() {
    outlines.value = [];
    selectedOutlineId.value = null;
    result.value = null;
    validationMessage.value = '';
    storageError.value = '';
  }

  // ── Calculation ──
  function calculate() {
    if (outlines.value.length === 0) {
      validationMessage.value = 'debugger.emptyMatrix';
      return;
    }

    const payload = {
      outlines: outlines.value.map((o) => ({
        boxId: o.boxId,
        width: o.width,
        height: o.height,
        cells: [...o.cells],
      })),
      columns: DEBUGGER_GRID_COLUMNS,
    };

    const algoResult = inferMinimumOccupiedCellsV2(payload);
    result.value = algoResult;

    // Persist
    const entry = createHistoryEntry(outlines.value, algoResult);
    saveHistoryEntry(entry);

    validationMessage.value = '';
  }

  // ── History persistence ──
  function loadHistory() {
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      history.value = deserializeHistory(raw);
    } catch (_err) {
      history.value = [];
    }
  }

  function saveHistoryEntry(entry) {
    try {
      const updated = [entry, ...history.value];
      const pruned = pruneHistory(updated, MAX_HISTORY_ENTRIES);
      const raw = serializeHistory(pruned);
      if (raw !== null) {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, raw);
        history.value = pruned;
      } else {
        storageError.value = 'debugger.storageError';
      }
    } catch (_err) {
      storageError.value = 'debugger.storageError';
    }
  }

  // ── Replay ──
  function restoreHistoryEntry(entry) {
    outlines.value = entry.outlines.map((o) => ({
      id: generateRuntimeId(),
      boxId: o.boxId,
      width: o.width,
      height: o.height,
      cells: [...o.cells],
    }));
    selectedOutlineId.value = null;
    result.value = null;
    validationMessage.value = '';
    storageError.value = '';
  }

  function recalculateHistoryEntry(entry) {
    restoreHistoryEntry(entry);
    // Run calculate after a microtask so the restored outlines are committed
    return Promise.resolve().then(() => {
      calculate();
    });
  }

  // ── Init ──
  loadHistory();

  return {
    outlines,
    selectedOutlineId,
    dragState,
    result,
    history,
    validationMessage,
    storageError,
    occupiedCellSet,
    addOutlineFromDrag,
    deleteOutline,
    clearMatrix,
    selectOutline,
    calculate,
    restoreHistoryEntry,
    recalculateHistoryEntry,
    isConflictingDrag,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/elsa/useMinimumCellsDebugger.js
git commit -m "feat: add minimum cells debugger composable"
```

---

### Task 4: Panel component

**Files:**
- Create: `src/elsa/ToolsMinimumCellsDebuggerPanel.vue`

**Interfaces:**
- Consumes: `useMinimumCellsDebugger` from Task 3; `useI18n` from `src/shared/i18n.js`; `DEBUGGER_GRID_ROWS`, `DEBUGGER_GRID_COLUMNS`, `cellToBoxId`, `boxIdToRowCol`, `normalizeRect`, `expandOutlineCells`, `rectToOutline` from Task 1
- Produces: Vue component renderable via `<component :is="...">` in App.vue

- [ ] **Step 1: Write the panel component**

```vue
<!-- src/elsa/ToolsMinimumCellsDebuggerPanel.vue -->
<script setup>
import { computed } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { useMinimumCellsDebugger } from './useMinimumCellsDebugger.js';
import {
  DEBUGGER_GRID_ROWS,
  DEBUGGER_GRID_COLUMNS,
  cellToBoxId,
  normalizeRect,
  rectToOutline,
  detectOverlap,
} from './minimum-cells-debugger.js';

const { t } = useI18n();
const {
  outlines,
  selectedOutlineId,
  dragState,
  result,
  history,
  validationMessage,
  storageError,
  occupiedCellSet,
  addOutlineFromDrag,
  deleteOutline,
  clearMatrix,
  selectOutline,
  calculate,
  restoreHistoryEntry,
  recalculateHistoryEntry,
  isConflictingDrag,
} = useMinimumCellsDebugger();

// ── Matrix rows for v-for ──
const rows = Array.from({ length: DEBUGGER_GRID_ROWS }, (_, r) => r);
const cols = Array.from({ length: DEBUGGER_GRID_COLUMNS }, (_, c) => c);

// ── Drag interaction state ──
let dragStartRow = null;
let dragStartCol = null;
let isDragging = false;

function getDragPreviewCells() {
  if (!dragState.value) return new Set();
  const { topRow, leftCol, bottomRow, rightCol } = normalizeRect(
    dragState.value.startRow,
    dragState.value.startCol,
    dragState.value.currentRow,
    dragState.value.currentCol,
  );
  const draft = rectToOutline(topRow, leftCol, bottomRow, rightCol, DEBUGGER_GRID_COLUMNS);
  return new Set(draft.cells);
}

const dragPreviewCells = computed(() => getDragPreviewCells());
const dragHasConflict = computed(() => {
  if (!dragState.value) return false;
  return isConflictingDrag(
    dragState.value.startRow,
    dragState.value.startCol,
    dragState.value.currentRow,
    dragState.value.currentCol,
  );
});

function cellClass(boxId) {
  const classes = ['debugger-cell'];
  if (occupiedCellSet.value.has(boxId)) {
    classes.push('is-occupied');
    const owner = outlines.value.find((o) => o.cells.includes(boxId));
    if (owner && owner.id === selectedOutlineId.value) {
      classes.push('is-selected');
    }
  } else if (dragPreviewCells.value.has(boxId)) {
    classes.push(dragHasConflict.value ? 'is-conflict' : 'is-dragging');
  }
  return classes.join(' ');
}

function onCellPointerDown(row, col, event) {
  event.preventDefault();
  dragStartRow = row;
  dragStartCol = col;
  isDragging = true;
  dragState.value = { startRow: row, startCol: col, currentRow: row, currentCol: col };
}

function onCellPointerEnter(row, col) {
  if (!isDragging) return;
  dragState.value = { startRow: dragStartRow, startCol: dragStartCol, currentRow: row, currentCol: col };
}

function onPointerUp() {
  if (!isDragging || !dragState.value) {
    isDragging = false;
    dragState.value = null;
    return;
  }
  const { startRow, startCol, currentRow, currentCol } = dragState.value;
  addOutlineFromDrag(startRow, startCol, currentRow, currentCol);
  isDragging = false;
  dragState.value = null;
}

function onPointerLeave() {
  if (isDragging) {
    // Cancel drag when leaving the grid area
    isDragging = false;
    dragState.value = null;
  }
}

// ── Result helpers ──
const hasResult = computed(() => result.value !== null);
const resultIsNull = computed(() => result.value === null);

// ── History helpers ──
function formatHistorySummary(entry) {
  return entry.summary || '';
}
</script>

<template>
  <div class="debugger-panel">
    <div class="debugger-head">
      <h2>{{ t('tools.debugger.title') }}</h2>
      <p>{{ t('tools.debugger.subtitle') }}</p>
    </div>

    <div class="debugger-body">
      <!-- Matrix -->
      <div class="debugger-matrix-wrap">
        <div
          class="debugger-matrix"
          :aria-label="t('tools.debugger.boardAria')"
          @pointerup="onPointerUp"
          @pointerleave="onPointerLeave"
        >
          <div
            v-for="row in rows"
            :key="row"
            class="debugger-row"
          >
            <div
              v-for="col in cols"
              :key="cellToBoxId(row, col, DEBUGGER_GRID_COLUMNS)"
              :class="cellClass(cellToBoxId(row, col, DEBUGGER_GRID_COLUMNS))"
              :data-box-id="cellToBoxId(row, col, DEBUGGER_GRID_COLUMNS)"
              :title="`Box ${cellToBoxId(row, col, DEBUGGER_GRID_COLUMNS)} (${row},${col})`"
              @pointerdown="onCellPointerDown(row, col, $event)"
              @pointerenter="onCellPointerEnter(row, col)"
            />
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="debugger-sidebar">
        <!-- Validation / error messages -->
        <p v-if="validationMessage" class="debugger-validation">{{ t(validationMessage) }}</p>
        <p v-if="storageError" class="debugger-storage-error">{{ t(storageError) }}</p>

        <!-- Action buttons -->
        <div class="debugger-actions">
          <button class="action-button" type="button" @click="calculate">{{ t('tools.debugger.calculate') }}</button>
          <button class="ghost-button" type="button" @click="clearMatrix">{{ t('tools.debugger.clear') }}</button>
        </div>

        <!-- Outline list -->
        <div class="debugger-outlines">
          <h3>{{ outlines.length }} outline(s)</h3>
          <p v-if="outlines.length === 0" class="debugger-empty">{{ t('tools.debugger.noOutlines') }}</p>
          <ul v-else class="debugger-outline-list">
            <li
              v-for="outline in outlines"
              :key="outline.id"
              :class="{ 'debugger-outline-item': true, 'is-selected': selectedOutlineId === outline.id }"
              @click="selectOutline(outline.id)"
            >
              <span class="debugger-outline-label">{{ t('tools.debugger.outlineLabel', { boxId: outline.boxId }) }}</span>
              <span class="debugger-outline-dims">{{ t('tools.debugger.outlineDims', { width: outline.width, height: outline.height }) }}</span>
              <span class="debugger-outline-cells">{{ t('tools.debugger.outlineCells', { count: outline.cells.length }) }}</span>
              <button class="ghost-button debugger-delete-btn" type="button" @click.stop="deleteOutline(outline.id)">{{ t('tools.debugger.delete') }}</button>
            </li>
          </ul>
        </div>

        <!-- Result -->
        <div v-if="hasResult || resultIsNull" class="debugger-result">
          <h3>Result</h3>

          <div v-if="resultIsNull && !hasResult" class="debugger-result-null">
            {{ t('tools.debugger.nullResult') }}
          </div>

          <template v-if="hasResult">
            <!-- Summary layer -->
            <dl class="debugger-result-summary">
              <div>
                <dt>{{ t('tools.debugger.resultValid') }}</dt>
                <dd>{{ result.valid ? '✓' : '✗' }}</dd>
              </div>
              <div>
                <dt>{{ t('tools.debugger.resultMinCells') }}</dt>
                <dd>{{ result.minTotalCells }}</dd>
              </div>
              <div>
                <dt>{{ t('tools.debugger.resultKnownCells') }}</dt>
                <dd>{{ result.knownOutlineCellCount }}</dd>
              </div>
              <div>
                <dt>{{ t('tools.debugger.resultUnknownBlockers') }}</dt>
                <dd>{{ result.unknownBlockingCellCount }}</dd>
              </div>
            </dl>

            <!-- Detail layer -->
            <details class="debugger-result-detail">
              <summary>{{ t('tools.debugger.resultDetails') }}</summary>
              <div class="debugger-detail-block">
                <h4>{{ t('tools.debugger.resultOrder') }}</h4>
                <code>{{ JSON.stringify(result.order) }}</code>
              </div>
              <div class="debugger-detail-block">
                <h4>{{ t('tools.debugger.resultUnknownBlockersList') }}</h4>
                <code>{{ JSON.stringify(result.unknownBlockingCells) }}</code>
              </div>
              <div class="debugger-detail-block">
                <h4>{{ t('tools.debugger.resultHoles') }}</h4>
                <code>{{ JSON.stringify(result.holeCells) }}</code>
              </div>
            </details>
          </template>
        </div>

        <div v-else class="debugger-no-result">
          <p>{{ t('tools.debugger.noResult') }}</p>
        </div>

        <!-- History -->
        <div class="debugger-history">
          <h3>{{ t('tools.debugger.historyTitle') }}</h3>
          <p v-if="history.length === 0" class="debugger-empty">{{ t('tools.debugger.historyEmpty') }}</p>
          <ol v-else class="debugger-history-list">
            <li
              v-for="entry in history"
              :key="entry.id"
              class="debugger-history-item"
            >
              <span class="debugger-history-summary">{{ entry.summary }}</span>
              <span class="debugger-history-time">{{ new Date(entry.createdAt).toLocaleString() }}</span>
              <div class="debugger-history-actions">
                <button class="ghost-button" type="button" @click="restoreHistoryEntry(entry)">{{ t('tools.debugger.restore') }}</button>
                <button class="ghost-button" type="button" @click="recalculateHistoryEntry(entry)">{{ t('tools.debugger.recalculate') }}</button>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debugger-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.debugger-head {
  flex-shrink: 0;
  padding: 0 0 12px 0;
}

.debugger-head h2 {
  margin: 0 0 4px 0;
  font-size: 16px;
}

.debugger-head p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary, #666);
}

.debugger-body {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

/* ── Matrix ── */
.debugger-matrix-wrap {
  flex-shrink: 0;
  overflow-y: auto;
  max-height: 100%;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
}

.debugger-matrix {
  display: grid;
  grid-template-columns: repeat(10, 24px);
  grid-template-rows: repeat(43, 24px);
  gap: 1px;
  background: var(--color-border, #ccc);
  padding: 1px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.debugger-row {
  display: contents;
}

.debugger-cell {
  width: 24px;
  height: 24px;
  background: var(--color-bg-cell-empty, #f0f0f0);
  cursor: crosshair;
  border-radius: 1px;
  transition: background 0.05s;
}

.debugger-cell.is-occupied {
  background: var(--color-accent, #4a90d9);
  cursor: pointer;
}

.debugger-cell.is-occupied.is-selected {
  outline: 2px solid var(--color-selected, #ff0);
  outline-offset: -1px;
}

.debugger-cell.is-dragging {
  background: var(--color-drag-preview, #8bc34a);
}

.debugger-cell.is-conflict {
  background: var(--color-conflict, #e53935);
}

/* ── Sidebar ── */
.debugger-sidebar {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 240px;
  overflow-y: auto;
}

.debugger-validation {
  margin: 0;
  padding: 6px 10px;
  background: var(--color-warn-bg, #fff3cd);
  border: 1px solid var(--color-warn-border, #ffc107);
  border-radius: 4px;
  font-size: 13px;
  color: var(--color-warn-text, #856404);
}

.debugger-storage-error {
  margin: 0;
  padding: 6px 10px;
  background: var(--color-err-bg, #fce4ec);
  border: 1px solid var(--color-err-border, #e53935);
  border-radius: 4px;
  font-size: 13px;
  color: var(--color-err-text, #c62828);
}

.debugger-actions {
  display: flex;
  gap: 8px;
}

.debugger-empty {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary, #888);
}

.debugger-outline-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.debugger-outline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  margin-bottom: 4px;
  cursor: pointer;
  font-size: 13px;
}

.debugger-outline-item.is-selected {
  border-color: var(--color-selected, #ff0);
  background: var(--color-selected-bg, #fff9c4);
}

.debugger-outline-label {
  font-weight: 600;
  min-width: 60px;
}

.debugger-outline-dims {
  color: var(--color-text-secondary, #666);
  min-width: 50px;
}

.debugger-outline-cells {
  color: var(--color-text-secondary, #888);
  flex: 1;
}

.debugger-delete-btn {
  font-size: 12px;
  padding: 2px 6px;
  color: var(--color-danger, #e53935);
}

.debugger-result h3,
.debugger-outlines h3,
.debugger-history h3 {
  margin: 0 0 6px 0;
  font-size: 14px;
}

.debugger-result-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 13px;
}

.debugger-result-summary dt {
  color: var(--color-text-secondary, #888);
}

.debugger-result-summary dd {
  margin: 0;
  font-weight: 600;
}

.debugger-result-null {
  font-size: 13px;
  color: var(--color-warn-text, #856404);
}

.debugger-result-detail {
  margin-top: 8px;
  font-size: 13px;
}

.debugger-detail-block {
  margin-top: 8px;
}

.debugger-detail-block h4 {
  margin: 0 0 2px 0;
  font-size: 12px;
  color: var(--color-text-secondary, #888);
}

.debugger-detail-block code {
  display: block;
  font-size: 11px;
  background: var(--color-code-bg, #f5f5f5);
  padding: 4px 6px;
  border-radius: 3px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.debugger-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.debugger-history-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 12px;
}

.debugger-history-summary {
  flex: 1 1 100%;
  font-weight: 600;
}

.debugger-history-time {
  color: var(--color-text-secondary, #888);
  flex: 1;
}

.debugger-history-actions {
  display: flex;
  gap: 4px;
}

.debugger-no-result {
  font-size: 13px;
  color: var(--color-text-secondary, #888);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/elsa/ToolsMinimumCellsDebuggerPanel.vue
git commit -m "feat: add minimum cells debugger panel component"
```

---

### Task 5: App.vue tab integration

**Files:**
- Modify: `src/elsa/App.vue:1-10` (imports), `src/elsa/App.vue:160-183` (tabs array)

**Interfaces:**
- Consumes: `ToolsMinimumCellsDebuggerPanel` from Task 4
- Produces: new `panel` tab entry in `tabs` array; lazy-mount behavior via existing `renderedPanelTabs` mechanism

- [ ] **Step 1: Add import for the debugger panel component**

In `src/elsa/App.vue`, add the import after the existing panel component imports (around line 7):

```js
import ToolsMinimumCellsDebuggerPanel from './ToolsMinimumCellsDebuggerPanel.vue';
```

Full import block after change:
```js
import TopBar from '../shared/TopBar.vue';
import ElsaHeroPanel from './ElsaHeroPanel.vue';
import EthanHeroPanel from '../ethan/App.vue';
import AhmedPanel from '../ahmed/AhmedPanel.vue';
import ToolsMinimumCellsDebuggerPanel from './ToolsMinimumCellsDebuggerPanel.vue';
```

- [ ] **Step 2: Add tab entry to the tabs array**

In the `tabs` array (around line 160-183), insert after the Ahmed entry and before `...solverTabs.map(...)`:

```js
  {
    kind: 'panel',
    titleKey: 'tools.tabs.minCellsDebugger',
    tabId: 'min-cells-debugger',
    panelKey: 'min-cells-debugger-panel',
    component: ToolsMinimumCellsDebuggerPanel,
  },
```

Full tabs array after change:
```js
const tabs = [
  {
    kind: 'panel',
    titleKey: 'tools.tabs.elsaHero',
    tabId: 'elsa',
    panelKey: 'elsa-hero',
    component: ElsaHeroPanel,
  },
  {
    kind: 'panel',
    titleKey: 'tools.tabs.ethanHero',
    tabId: 'ethan',
    panelKey: 'ethan-hero',
    component: EthanHeroPanel,
  },
  {
    kind: 'panel',
    titleKey: 'tools.tabs.ahmedCalculator',
    tabId: 'ahmed',
    panelKey: 'ahmed-panel',
    component: AhmedPanel,
  },
  {
    kind: 'panel',
    titleKey: 'tools.tabs.minCellsDebugger',
    tabId: 'min-cells-debugger',
    panelKey: 'min-cells-debugger-panel',
    component: ToolsMinimumCellsDebuggerPanel,
  },
  ...solverTabs.map((tab) => ({ kind: 'solver', ...tab })),
];
```

- [ ] **Step 3: Verify the existing panel tab rendering logic needs no changes**

The template at lines 945-952 already renders all `panelTabs` via:
```html
<template v-for="tab in panelTabs" :key="tab.tabId">
  <component
    :is="tab.component"
    v-if="renderedPanelTabs[tab.tabId]"
    v-show="activeTab.kind === 'panel' && activeTab.tabId === tab.tabId"
    v-bind="tab.tabId === 'ahmed' ? { embedded: true } : {}"
  />
</template>
```

The new debugger tab does not need `embedded: true` — the existing `v-bind` only adds it for `ahmed`, so the debugger receives no extra props. This is correct.

Also verify: the debugger tab is not `'elsa'`, so `renderedPanelTabs` initializes its entry to `false` by default (line 201-204) — the panel is lazy-mounted only when the user first switches to it. This is correct.

- [ ] **Step 4: Verify the tab renders without errors**

Run: `npx vitest run src/elsa/App.test.js`
Expected: Existing tests still pass (any failures are pre-existing baseline failures). No new failures introduced.

- [ ] **Step 5: Quick smoke test — mount App and verify debugger tab button exists**

Add a temporary check:
Run: `node --input-type=module -e "import { mount } from '@vue/test-utils'; console.log('test-utils available');"`
(If vitest with happy-dom works, the integration test in Task 6 provides proper coverage.)

- [ ] **Step 6: Commit**

```bash
git add src/elsa/App.vue
git commit -m "feat: add minimum cells debugger tab to Tools page"
```

---

### Task 6: Integration tests

**Files:**
- Modify: `src/elsa/App.test.js` — add debugger-specific integration tests

**Interfaces:**
- Consumes: All prior tasks; the existing `App.vue` test setup (mount, localStorage mock, etc.)
- Produces: Integration test coverage for debugger tab

- [ ] **Step 1: Add debugger integration tests to App.test.js**

Append the following test block before the end of the file (before any existing closing braces, ensuring it's inside the top-level `describe` if the file uses one, or at the module scope if it uses file-level tests).

First, check the structure of App.test.js to determine the insertion point:

```bash
grep -n "^describe\|^it(" src/elsa/App.test.js | head -20
```

Based on the existing structure, add the following tests. If App.test.js wraps tests in a `describe('App', ...)` block, add inside it. Otherwise add at module level.

```js
describe('minimum cells debugger tab', () => {
  const DEBUGGER_HISTORY_KEY = 'bidking-tools-min-cells-debugger-history:v1';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function mountApp() {
    return mount(App, {
      global: {
        stubs: {
          TopBar: { template: '<header class="topbar-stub"></header>' },
          ElsaHeroPanel: { template: '<div class="elsa-hero-stub">Elsa Panel</div>' },
          EthanHeroPanel: { template: '<div class="ethan-hero-stub">Ethan Panel</div>' },
          AhmedPanel: { template: '<div class="ahmed-stub">Ahmed Panel</div>' },
          ToolsMinimumCellsDebuggerPanel: false, // don't stub — render the real component
        },
      },
    });
  }

  it('renders the debugger tab button in the Tools tab list', () => {
    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    const debuggerButton = buttons.find((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    expect(debuggerButton).toBeTruthy();
    wrapper.unmount();
  });

  it('switches to the debugger tab and renders the matrix', async () => {
    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    // Find the debugger tab button (4th panel tab, after Elsa/Ethan/Ahmed)
    const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    expect(tabButtons.length).toBeGreaterThan(0);
    await tabButtons[0].trigger('click');
    await wrapper.vm.$nextTick();
    // Matrix should be visible
    expect(wrapper.find('.debugger-matrix').exists()).toBe(true);
    // Cell count should be 43*10 = 430
    expect(wrapper.findAll('.debugger-cell').length).toBe(430);
    wrapper.unmount();
  });

  it('shows validation message when calculating with no outlines', async () => {
    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    await tabButtons[0].trigger('click');
    await wrapper.vm.$nextTick();
    // Click Calculate without adding outlines
    const calculateBtn = wrapper.find('.debugger-actions .action-button');
    await calculateBtn.trigger('click');
    await wrapper.vm.$nextTick();
    // Validation message should appear
    expect(wrapper.find('.debugger-validation').exists()).toBe(true);
    wrapper.unmount();
  });

  it('adds an outline via drag simulation, calculates, and shows result', async () => {
    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    await tabButtons[0].trigger('click');
    await wrapper.vm.$nextTick();

    // Directly call the composable's addOutlineFromDrag — we access it via
    // the panel component's exposed state. Since the composable is used
    // inside the panel and the panel doesn't use defineExpose, we simulate
    // the drag via DOM events on the matrix cells.
    const cells = wrapper.findAll('.debugger-cell');
    // Drag from (0,0) to (1,1): 2×2 outline at boxId 1
    await cells[0].trigger('pointerdown', { button: 0 });
    await cells[12].trigger('pointerenter'); // row 1 col 1 = boxId 12
    await wrapper.find('.debugger-matrix').trigger('pointerup');
    await wrapper.vm.$nextTick();

    // An outline should be created
    expect(wrapper.findAll('.debugger-outline-item').length).toBe(1);

    // Calculate
    const calculateBtn = wrapper.find('.debugger-actions .action-button');
    await calculateBtn.trigger('click');
    await wrapper.vm.$nextTick();

    // Result should be displayed
    // (the exact outcome depends on the V2 algorithm for a single 2x2 at boxId 1)
    expect(wrapper.find('.debugger-result').exists()).toBe(true);
    wrapper.unmount();
  });

  it('persists calculation to history in local storage', async () => {
    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    await tabButtons[0].trigger('click');
    await wrapper.vm.$nextTick();

    // Add outline and calculate
    const cells = wrapper.findAll('.debugger-cell');
    await cells[0].trigger('pointerdown', { button: 0 });
    await cells[12].trigger('pointerenter');
    await wrapper.find('.debugger-matrix').trigger('pointerup');
    await wrapper.vm.$nextTick();

    const calculateBtn = wrapper.find('.debugger-actions .action-button');
    await calculateBtn.trigger('click');
    await wrapper.vm.$nextTick();

    // History should be written to localStorage
    const raw = localStorage.getItem(DEBUGGER_HISTORY_KEY);
    expect(raw).toBeTruthy();
    const history = JSON.parse(raw);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].outlines).toBeDefined();
    expect(history[0].result).toBeDefined();
    wrapper.unmount();
  });

  it('debugger history survives leave-tools cache clearing', () => {
    // Pre-populate debugger history in storage
    const entry = {
      id: 'test-entry',
      createdAt: new Date().toISOString(),
      version: 1,
      grid: { rows: 43, columns: 10 },
      outlines: [],
      result: null,
      summary: 'test',
    };
    localStorage.setItem(DEBUGGER_HISTORY_KEY, JSON.stringify([entry]));

    // Dispatch leave-tools event (the same event TopBar dispatches)
    window.dispatchEvent(new CustomEvent('bidking:leave-tools'));

    // Debugger history key should NOT be cleared
    const raw = localStorage.getItem(DEBUGGER_HISTORY_KEY);
    expect(raw).toBeTruthy();
    const history = JSON.parse(raw);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('test-entry');

    // Tools page state keys SHOULD be cleared
    expect(localStorage.getItem('bidking-page-state:v2:elsa')).toBeNull();
  });

  it('history entry can be restored into the matrix', async () => {
    // Pre-populate with a known history entry
    const entry = {
      id: 'hist-restore-test',
      createdAt: new Date().toISOString(),
      version: 1,
      grid: { rows: 43, columns: 10 },
      outlines: [
        { boxId: 5, width: 2, height: 2, cells: [5, 6, 15, 16] },
      ],
      result: { valid: true, minTotalCells: 4, knownOutlineCellCount: 4, unknownBlockingCellCount: 0, unknownBlockingCells: [], order: [5], holeCells: [] },
      summary: '1 items / 4 known cells / min 4',
    };
    localStorage.setItem(DEBUGGER_HISTORY_KEY, JSON.stringify([entry]));

    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    await tabButtons[0].trigger('click');
    await wrapper.vm.$nextTick();

    // Should see the history entry
    const historyItems = wrapper.findAll('.debugger-history-item');
    expect(historyItems.length).toBe(1);

    // Click Restore
    const restoreBtn = historyItems[0].find('.debugger-history-actions button:first-child');
    await restoreBtn.trigger('click');
    await wrapper.vm.$nextTick();

    // Outline should appear in the matrix
    expect(wrapper.findAll('.debugger-outline-item').length).toBe(1);
    wrapper.unmount();
  });

  it('debugger labels render translated text, not raw i18n keys', async () => {
    const wrapper = mountApp();
    const buttons = wrapper.findAll('.tab-button');
    const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
    await tabButtons[0].trigger('click');
    await wrapper.vm.$nextTick();

    // The heading should not show the raw key
    const heading = wrapper.find('.debugger-head h2');
    expect(heading.text()).not.toBe('tools.debugger.title');
    // The calculate button should show text, not a key
    const calcBtn = wrapper.find('.debugger-actions .action-button');
    expect(calcBtn.text()).not.toBe('tools.debugger.calculate');
    // The empty-outlines message should show text, not a key
    const emptyMsg = wrapper.find('.debugger-outlines .debugger-empty');
    expect(emptyMsg.text()).not.toBe('tools.debugger.noOutlines');

    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run src/elsa/App.test.js`
Expected: New debugger tests pass. Pre-existing failures in OTHER test files are not caused by this change.

Note: the drag simulation tests may need adjustment based on how PointerEvent works in happy-dom. If pointer events don't bubble correctly, the tests may need to call the composable methods directly via `wrapper.getComponent('.debugger-panel')` if the component exposes its methods. If the component does not use `defineExpose`, update the component to expose the composable:

In `ToolsMinimumCellsDebuggerPanel.vue`, add after the `<script setup>` block (before `</script>`):

```js
defineExpose({ addOutlineFromDrag, calculate, outlines, result, history });
```

This allows tests to bypass DOM pointer simulation and call the methods directly.

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm test`
Expected: No new failures beyond the pre-existing baseline (listed in the spec).

- [ ] **Step 4: Commit**

```bash
git add src/elsa/App.test.js src/elsa/ToolsMinimumCellsDebuggerPanel.vue
git commit -m "test: add minimum cells debugger integration tests"
```

---

## Verification

After all tasks, run the full verification set:

```bash
npx vitest run src/elsa/minimum-cells-debugger.test.js
npx vitest run src/elsa/App.test.js
npx vitest run src/ethan/monitor-grid.test.js
npm test
```

Confirm:
- Pure helper tests: all pass
- App integration tests: new debugger tests pass; pre-existing tests unchanged
- Monitor grid tests: unchanged
- No new failures in the full suite beyond the pre-existing baseline
