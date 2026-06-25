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
