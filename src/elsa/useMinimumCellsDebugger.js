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
  const result = ref(undefined);
  const history = ref([]);
  const validationMessage = ref('');
  const storageError = ref('');
  const diskPersistenceError = ref('');
  const lastPayloadOutlines = ref([]);

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
      validationMessage.value = 'tools.debugger.conflict';
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
    result.value = undefined;
    validationMessage.value = '';
  }

  function selectOutline(id) {
    selectedOutlineId.value = selectedOutlineId.value === id ? null : id;
  }

  function clearMatrix() {
    outlines.value = [];
    selectedOutlineId.value = null;
    result.value = undefined;
    validationMessage.value = '';
    storageError.value = '';
    diskPersistenceError.value = '';
  }

  // ── Calculation ──
  function calculate() {
    if (outlines.value.length === 0) {
      validationMessage.value = 'tools.debugger.emptyMatrix';
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

    lastPayloadOutlines.value = payload.outlines;
    const algoResult = inferMinimumOccupiedCellsV2(payload);
    result.value = algoResult;

    // Persist
    const entry = createHistoryEntry(outlines.value, algoResult);
    saveHistoryEntry(entry);
    persistHistoryEntryToDisk(entry);

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
        storageError.value = 'tools.debugger.storageError';
      }
    } catch (_err) {
      storageError.value = 'tools.debugger.storageError';
    }
  }

  function persistHistoryEntryToDisk(entry) {
    if (typeof fetch !== 'function') return;

    fetch('/api/tools/min-cells-debugger/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        diskPersistenceError.value = '';
      })
      .catch(() => {
        diskPersistenceError.value = 'tools.debugger.diskPersistenceError';
      });
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
    result.value = undefined;
    validationMessage.value = '';
    storageError.value = '';
    diskPersistenceError.value = '';
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
    diskPersistenceError,
    lastPayloadOutlines,
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
