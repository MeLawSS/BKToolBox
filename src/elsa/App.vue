<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import TopBar from '../shared/TopBar.vue';
import ElsaHeroPanel from './ElsaHeroPanel.vue';
import EthanHeroPanel from '../ethan/EthanHeroPanel.vue';
import AhmedPanel from '../ahmed/AhmedPanel.vue';
import {
  applySolverOutputMessage,
  buildSolverOutputSnapshot,
  createSolverOutputRunState,
} from './tools-run-output-worker-core.js';
import { useI18n } from '../shared/i18n.js';
import {
  clearToolsPageStateStorage,
  LEAVE_TOOLS_EVENT,
  LEGACY_TOOLS_PAGE_STATE_KEY,
  TOOLS_PAGE_STATE_KEY,
} from '../shared/tools-page-lifecycle.js';
import { useTheme } from '../shared/theme.js';

const solverTabs = [
  {
    tabId: 'gold-average',
    titleKey: 'tools.tabs.goldAverage',
    script: 'solve-gold-combo.js',
    resultMode: 'table',
    fields: [
      { key: 'avg', labelKey: 'tools.fields.averagePrice', type: 'decimal', placeholderKey: 'tools.placeholders.averagePrice', required: true },
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countOptional' },
    ],
    getArgs: values => values.count ? `${values.avg} ${values.count}` : values.avg,
  },
  {
    tabId: 'gold-total',
    titleKey: 'tools.tabs.goldTotal',
    script: 'solve-gold-total.js',
    resultMode: 'table',
    fields: [
      { key: 'total', labelKey: 'tools.fields.totalPrice', type: 'decimal', placeholderKey: 'tools.placeholders.totalPrice', required: true },
    ],
    getArgs: values => values.total,
  },
  {
    tabId: 'gold-grid',
    titleKey: 'tools.tabs.goldGrid',
    script: 'solve-gold-grid.js',
    resultMode: 'table',
    fields: [
      { key: 'avg', labelKey: 'tools.fields.averageCells', type: 'decimal', placeholderKey: 'tools.placeholders.averageCells', required: true },
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countOptional' },
    ],
    getArgs: values => values.count ? `${values.avg} ${values.count}` : values.avg,
  },
  {
    tabId: 'purple-grid',
    titleKey: 'tools.tabs.purpleGrid',
    script: 'solve-purple-grid.js',
    resultMode: 'table',
    fields: [
      { key: 'avg', labelKey: 'tools.fields.averageCells', type: 'decimal', placeholderKey: 'tools.placeholders.averageCells', required: true },
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countOptional' },
    ],
    getArgs: values => values.count ? `${values.avg} ${values.count}` : values.avg,
  },
  {
    tabId: 'purple-average',
    titleKey: 'tools.tabs.purpleAverage',
    script: 'solve-purple-combo.js',
    resultMode: 'table',
    fields: [
      { key: 'avg', labelKey: 'tools.fields.averagePrice', type: 'decimal', placeholderKey: 'tools.placeholders.purpleAveragePrice', required: true },
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countOptional' },
      { key: 'dedupeTotalCells', labelKey: 'tools.fields.dedupeTotalCells', type: 'switch' },
    ],
    getArgs: values => {
      const args = values.count ? `${values.avg} ${values.count}` : values.avg;
      return values.dedupeTotalCells ? `${args} dedupe-total-cells` : args;
    },
  },
  {
    tabId: 'purple-total',
    titleKey: 'tools.tabs.purpleTotal',
    script: 'solve-purple-total.js',
    resultMode: 'table',
    fields: [
      { key: 'total', labelKey: 'tools.fields.totalPrice', type: 'decimal', placeholderKey: 'tools.placeholders.totalPrice', required: true },
    ],
    getArgs: values => values.total,
  },
  {
    tabId: 'red-grid',
    titleKey: 'tools.tabs.redGrid',
    script: 'solve-red-grid.js',
    resultMode: 'table',
    fields: [
      { key: 'avg', labelKey: 'tools.fields.averageCells', type: 'decimal', placeholderKey: 'tools.placeholders.averageCells', required: true },
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countOptional' },
    ],
    getArgs: values => values.count ? `${values.avg} ${values.count}` : values.avg,
  },
  {
    tabId: 'category-average',
    titleKey: 'tools.tabs.categoryAverage',
    script: 'solve-type-combo.js',
    resultMode: 'table',
    fields: [
      {
        key: 'type',
        labelKey: 'tools.fields.category',
        type: 'select',
        options: [
          { value: '家居日用', labelKey: 'tools.categories.household' },
          { value: '医疗用品', labelKey: 'tools.categories.medical' },
          { value: '时尚潮流', labelKey: 'tools.categories.fashion' },
          { value: '武器装备', labelKey: 'tools.categories.weapons' },
          { value: '数码电子', labelKey: 'tools.categories.electronics' },
          { value: '矿物珠宝', labelKey: 'tools.categories.minerals' },
          { value: '文玩古董', labelKey: 'tools.categories.antiques' },
          { value: '交通工具', labelKey: 'tools.categories.vehicles' },
          { value: '食品烹饪', labelKey: 'tools.categories.food' },
          { value: '书籍绘画', labelKey: 'tools.categories.books' },
        ],
        required: true,
      },
      { key: 'avg', labelKey: 'tools.fields.averagePrice', type: 'decimal', placeholderKey: 'tools.placeholders.averagePrice', required: true },
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countOptional' },
    ],
    getArgs: values => values.count ? `${values.type} ${values.avg} ${values.count}` : `${values.type} ${values.avg}`,
  },
  {
    tabId: 'count-average',
    titleKey: 'tools.tabs.countAverage',
    script: 'solve-average-price-combo.js',
    resultMode: 'table',
    fields: [
      { key: 'count', labelKey: 'tools.fields.count', type: 'numeric', placeholderKey: 'tools.placeholders.countRequired', required: true },
      { key: 'avg', labelKey: 'tools.fields.averagePrice', type: 'decimal', placeholderKey: 'tools.placeholders.averagePrice', required: true },
      { key: 'dedupeGoldRed', labelKey: 'tools.fields.dedupeGoldRed', type: 'switch' },
    ],
    getArgs: values => values.dedupeGoldRed
      ? `${values.count} ${values.avg} dedupe-gold-red`
      : `${values.count} ${values.avg}`,
  },
];

function getDefaultFieldValue(field) {
  if (field.type === 'select') return field.options[0].value;
  if (field.type === 'switch') return false;
  return '';
}

function createTabValueState(tab) {
  const state = {};
  (tab.fields || []).forEach((field) => {
    state[field.key] = getDefaultFieldValue(field);
  });
  return state;
}

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
  ...solverTabs.map((tab) => ({ kind: 'solver', ...tab })),
];

const pageStateKey = TOOLS_PAGE_STATE_KEY;
const legacyPageStateKey = LEGACY_TOOLS_PAGE_STATE_KEY;
const legacyStateTabIds = [
  'gold-average',
  'gold-total',
  'gold-grid',
  'purple-grid',
  'red-grid',
  'category-average',
  'count-average',
  'purple-average',
  'purple-total',
  'elsa',
];
const panelTabs = tabs.filter((tab) => tab.kind === 'panel');
const activeTabIndex = ref(0);
const renderedPanelTabs = reactive(Object.fromEntries(panelTabs.map((tab) => [
  tab.tabId,
  tab.tabId === 'elsa',
])));
const globalLimit = ref('');
const { t, isEnglish, toggleLocale } = useI18n();
const { resolvedTheme, themeButtonClass, toggleTheme } = useTheme();
const outputRefs = ref([]);
const sources = Array(tabs.length).fill(null);
const filters = reactive(tabs.map(() => ''));
const outputs = reactive(tabs.map(() => []));
const solverViews = reactive(tabs.map(() => ({
  lines: [],
  rows: [],
  statusLine: '',
  statusKind: 'default',
})));
const running = reactive(tabs.map(() => false));
const tableSorts = reactive(tabs.map(() => ({ key: '', direction: 'asc' })));
const values = reactive(tabs.map((tab) => createTabValueState(tab)));
let isRestoring = false;
let isDiscardingPageState = false;
let solverOutputWorker = null;
let solverOutputWorkerDisabled = false;
let nextSolverRunId = 1;
const workerRunIdByTab = Array(tabs.length).fill(0);
const workerTabByRunId = new Map();
const resetOutputOnNextSource = Array(tabs.length).fill(false);

const activeTab = computed(() => tabs[activeTabIndex.value] || tabs[0]);
const activeSolverTab = computed(() => activeTab.value?.kind === 'solver' ? activeTab.value : null);
const themeAriaLabel = computed(() => resolvedTheme.value === 'light'
  ? t('common.switchThemeToDark')
  : t('common.switchThemeToLight'));
const themeButtonTitle = computed(() => resolvedTheme.value === 'light'
  ? t('common.switchThemeToDark')
  : t('common.switchThemeToLight'));
const tableColumns = [
  { key: 'count', labelKey: 'tools.columns.count', sortable: true },
  { key: 'totalCells', labelKey: 'tools.columns.totalCells', sortable: true },
  { key: 'totalPrice', labelKey: 'tools.columns.totalPrice', sortable: true },
  { key: 'combo', labelKey: 'tools.columns.combo', sortable: false },
];

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function formatLine(raw) {
  const clean = stripAnsi(raw);

  if (/^Count=\d+/.test(clean)) {
    return [{ text: clean, className: 'cyan' }];
  }

  if (!/TotalCells=/.test(clean)) {
    return [{ text: clean, className: '' }];
  }

  const segments = [];
  const re = /(TotalCells=\d+)|(TotalPrice=\d+)|(Count=\d+)/g;
  let last = 0;
  let match;

  while ((match = re.exec(clean)) !== null) {
    if (match.index > last) {
      segments.push({ text: clean.slice(last, match.index), className: '' });
    }
    segments.push({
      text: match[0],
      className: match[1] ? 'cells' : match[2] ? 'price' : 'cyan',
    });
    last = re.lastIndex;
  }

  if (last < clean.length) {
    segments.push({ text: clean.slice(last), className: '' });
  }

  return segments;
}

function ensurePanelRendered(index) {
  const tab = tabs[index];
  if (tab?.kind === 'panel') {
    renderedPanelTabs[tab.tabId] = true;
  }
}

function makeLine(text, className = '') {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    className,
    segments: className ? [{ text, className }] : formatLine(text),
  };
}

function getLineTotalCells(line) {
  const match = stripAnsi(line.text).match(/^\s*TotalCells=(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseResultRow(line) {
  const clean = stripAnsi(line.text);
  const match = clean.match(/^\s*TotalCells=(\d+),\s*TotalPrice=(\d+),\s*Count=(\d+):\s*(.*)$/);
  if (!match) return null;

  return {
    id: line.id,
    text: clean,
    totalCells: Number(match[1]),
    totalPrice: Number(match[2]),
    count: Number(match[3]),
    combo: match[4],
  };
}

function isCountHeader(line) {
  return /^Count=\d+/.test(stripAnsi(line.text));
}

function isEmptyCombinationLine(line) {
  return stripAnsi(line.text).trim() === '(no combination found)';
}

function usesTableOutput(index) {
  return tabs[index]?.resultMode === 'table';
}

function getTableRows(index) {
  return solverViews[index]?.rows || [];
}

function getLineStatusText(line) {
  const clean = stripAnsi(line.text).trim();
  if (!clean || isCountHeader(line) || isEmptyCombinationLine(line) || parseResultRow(line)) return '';
  if (/^\[完成/.test(clean)) return t('tools.status.done');
  if (clean === '[已停止]') return t('tools.status.stopped');
  if (clean === '[连接已关闭]') return t('tools.status.closed');
  if (clean === '请输入参数') return t('tools.inputRequired');
  return clean;
}

function getRunStatus(index) {
  if (running[index]) return t('tools.status.running');
  const status = solverViews[index]?.statusLine || '';
  if (status) return getLineStatusText({ text: status });
  return t('tools.status.waiting');
}

function getRunStatusKind(index) {
  if (running[index]) return 'running';
  return solverViews[index]?.statusKind || 'default';
}

function getRunStatusClass(index) {
  const statusKind = getRunStatusKind(index);
  return {
    'run-status': true,
    'is-running': statusKind === 'running',
    'is-error': statusKind === 'error',
  };
}

function toggleTableSort(index, key) {
  const sort = tableSorts[index];
  if (!sort) return;

  if (sort.key === key) {
    sort.direction = sort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    sort.key = key;
    sort.direction = 'asc';
  }

  if (postWorkerMessage(index, {
    type: 'set-sort',
    runId: workerRunIdByTab[index],
    sort: { ...sort },
  })) return;

  refreshSolverView(index);
}

function getSortIndicator(index, key) {
  const sort = tableSorts[index];
  if (!sort || sort.key !== key) return '';
  return sort.direction === 'asc' ? ' ↑' : ' ↓';
}

function getFilteredLines(index) {
  return solverViews[index]?.lines || [];
}

function getTabIndexById(tabId) {
  if (!tabId) return null;
  const index = tabs.findIndex((tab) => tab.tabId === tabId);
  return index >= 0 ? index : null;
}

function getLocationTabId() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('tab') || '';
}

function syncLocationToTab(index) {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return;

  const tabId = tabs[index]?.tabId || '';
  const nextUrl = new URL(window.location.href);
  if (!tabId || tabId === 'elsa') {
    nextUrl.searchParams.delete('tab');
  } else {
    nextUrl.searchParams.set('tab', tabId);
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath !== currentPath) {
    window.history.replaceState(window.history.state ?? {}, '', nextPath);
  }
}

function getArgs(index) {
  const tab = tabs[index];
  const tabValues = values[index];
  const missing = tab.fields.find(field => field.required && !String(tabValues[field.key] ?? '').trim());
  if (missing) return null;
  return tab.getArgs(tabValues).trim();
}

function readSavedState(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key));
  } catch (_error) {
    return null;
  }
}

function cloneOutputState(lines) {
  return lines.map((line) => ({
    text: line.text,
    className: line.className,
  }));
}

function buildValuesByTabId() {
  return Object.fromEntries(tabs.map((tab, index) => [tab.tabId, { ...values[index] }]));
}

function buildFiltersByTabId() {
  return Object.fromEntries(tabs.map((tab, index) => [tab.tabId, filters[index]]));
}

function buildOutputsByTabId() {
  return Object.fromEntries(tabs.map((tab, index) => [tab.tabId, cloneOutputState(outputs[index])]));
}

function buildSavedStateSnapshot() {
  return {
    version: 2,
    activeTabId: tabs[activeTabIndex.value]?.tabId || tabs[0].tabId,
    globalLimit: globalLimit.value,
    filtersByTabId: buildFiltersByTabId(),
    valuesByTabId: buildValuesByTabId(),
    outputsByTabId: buildOutputsByTabId(),
    savedAt: new Date().toISOString(),
  };
}

function mapLegacyArrayByTabId(source, tabIds) {
  const result = {};
  if (!Array.isArray(source)) return result;
  tabIds.forEach((tabId, index) => {
    if (index < source.length) {
      result[tabId] = source[index];
    }
  });
  return result;
}

function migrateLegacySavedState(saved) {
  if (!saved || typeof saved !== 'object') return null;
  return {
    version: 2,
    activeTabId: Number.isInteger(saved.activeTabIndex)
      ? (legacyStateTabIds[saved.activeTabIndex] || legacyStateTabIds[0])
      : legacyStateTabIds[0],
    globalLimit: typeof saved.globalLimit === 'string' ? saved.globalLimit : '',
    filtersByTabId: mapLegacyArrayByTabId(saved.filters, legacyStateTabIds),
    valuesByTabId: mapLegacyArrayByTabId(saved.values, legacyStateTabIds),
    outputsByTabId: mapLegacyArrayByTabId(saved.outputs, legacyStateTabIds),
    savedAt: typeof saved.savedAt === 'string' ? saved.savedAt : null,
  };
}

function loadSavedState() {
  const current = readSavedState(pageStateKey);
  if (current && typeof current === 'object') {
    return { state: current, migrated: false };
  }
  const legacy = migrateLegacySavedState(readSavedState(legacyPageStateKey));
  return { state: legacy, migrated: Boolean(legacy) };
}

function coerceFieldValue(field, value) {
  if (field.type === 'switch') {
    return value === true || value === 'true';
  }
  return String(value ?? '');
}

function appendOutput(index, text, className = '') {
  const currentOutput = outputRefs.value[index];
  const previousScrollTop = currentOutput ? currentOutput.scrollTop : null;
  applySolverSourceMessage(index, { type: 'status', text, className });

  nextTick(() => {
    const output = outputRefs.value[index];
    if (output) {
      output.scrollTop = previousScrollTop ?? 0;
    }
  });
}

function cloneRawLines(lines) {
  return (lines || []).map((line) => ({
    text: line?.text ?? '',
    className: typeof line?.className === 'string' ? line.className : '',
  }));
}

function setSolverView(index, snapshot = {}) {
  outputs[index] = cloneRawLines(snapshot.rawLines).map((line) => makeLine(line.text, line.className));
  solverViews[index] = {
    lines: (snapshot.lines || []).map((line) => ({
      ...line,
      text: line?.text ?? '',
      className: typeof line?.className === 'string' ? line.className : '',
      segments: Array.isArray(line?.segments) ? line.segments : formatLine(line?.text ?? ''),
    })),
    rows: (snapshot.rows || []).map((row) => ({ ...row })),
    statusLine: typeof snapshot.statusLine === 'string'
      ? snapshot.statusLine
      : typeof snapshot.statusText === 'string'
        ? snapshot.statusText
        : '',
    statusKind: snapshot.statusKind === 'error' ? 'error' : 'default',
  };
}

function createSnapshotFromRaw(index) {
  const tab = tabs[index];
  const state = applySolverOutputMessage(createSolverOutputRunState({
    runId: workerRunIdByTab[index],
    resultMode: tab?.resultMode,
    script: tab?.script,
    args: getArgs(index) || '',
    filter: filters[index],
    sort: tableSorts[index],
  }), {
    type: 'hydrate-lines',
    rawLines: cloneOutputState(outputs[index]),
  });
  return buildSolverOutputSnapshot(state);
}

function refreshSolverView(index) {
  const tab = tabs[index];
  if (!tab || tab.kind !== 'solver') return;
  setSolverView(index, createSnapshotFromRaw(index));
}

function handleFilterChange(index) {
  if (postWorkerMessage(index, {
    type: 'set-filter',
    runId: workerRunIdByTab[index],
    filter: filters[index],
  })) return;
  refreshSolverView(index);
}

function handleWorkerSnapshot(index, runId, snapshot) {
  if (!Number.isInteger(runId) || workerRunIdByTab[index] !== runId) return;
  if (
    running[index] &&
    Array.isArray(snapshot.rawLines) &&
    snapshot.rawLines.length === 0 &&
    outputs[index].length > 0
  ) {
    return;
  }
  setSolverView(index, snapshot);
}

function disableSolverOutputWorker() {
  if (solverOutputWorker) {
    solverOutputWorker.terminate();
    solverOutputWorker = null;
  }
  solverOutputWorkerDisabled = true;
}

function ensureSolverOutputWorker() {
  if (solverOutputWorker || solverOutputWorkerDisabled || typeof Worker === 'undefined') return solverOutputWorker;
  try {
    const worker = new Worker(new URL('./tools-run-output-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type !== 'snapshot') return;
      const index = workerTabByRunId.get(message.runId);
      if (index === undefined) return;
      handleWorkerSnapshot(index, message.runId, message);
    };
    worker.onerror = () => {
      disableSolverOutputWorker();
    };
    solverOutputWorker = worker;
  } catch (_error) {
    disableSolverOutputWorker();
  }
  return solverOutputWorker;
}

function postWorkerMessage(index, message) {
  const worker = ensureSolverOutputWorker();
  if (!worker || !message?.runId) return false;
  worker.postMessage(message);
  return true;
}

function cancelWorkerRun(index) {
  const runId = workerRunIdByTab[index];
  if (!runId) return;
  if (solverOutputWorker) {
    solverOutputWorker.postMessage({ type: 'cancel', runId });
  }
  workerTabByRunId.delete(runId);
  workerRunIdByTab[index] = 0;
}

function startWorkerRun(index, args) {
  const worker = ensureSolverOutputWorker();
  if (!worker) return false;

  const runId = nextSolverRunId;
  nextSolverRunId += 1;
  workerRunIdByTab[index] = runId;
  workerTabByRunId.set(runId, index);
  worker.postMessage({
    type: 'start',
    runId,
    resultMode: tabs[index]?.resultMode,
    script: tabs[index]?.script,
    args,
    filter: filters[index],
    sort: { ...tableSorts[index] },
  });
  return true;
}

function applyLocalSolverMessage(index, message) {
  const tab = tabs[index];
  const nextState = applySolverOutputMessage(applySolverOutputMessage(createSolverOutputRunState({
    runId: workerRunIdByTab[index],
    resultMode: tab?.resultMode,
    script: tab?.script,
    args: getArgs(index) || '',
    filter: filters[index],
    sort: tableSorts[index],
  }), {
    type: 'hydrate-lines',
    rawLines: cloneOutputState(outputs[index]),
  }), message);
  setSolverView(index, buildSolverOutputSnapshot(nextState));
}

function applySolverSourceMessage(index, sourceMessage) {
  if (resetOutputOnNextSource[index]) {
    outputs[index] = [];
    solverViews[index] = {
      lines: [],
      rows: [],
      statusLine: '',
      statusKind: 'default',
    };
    resetOutputOnNextSource[index] = false;
  }
  if (postWorkerMessage(index, {
    type: 'append-source',
    runId: workerRunIdByTab[index],
    message: sourceMessage,
  })) return;
  applyLocalSolverMessage(index, {
    type: 'append-source',
    message: sourceMessage,
  });
}

function stop(index) {
  if (sources[index]) {
    sources[index].close();
    sources[index] = null;
  }
  running[index] = false;
  cancelWorkerRun(index);
  applySolverSourceMessage(index, { type: 'status', text: '[已停止]', className: 'dim' });
  saveState();
}

function run(index) {
  window.bidkingDesktop?.resetInjectionTimer?.();

  if (sources[index]) {
    sources[index].close();
    sources[index] = null;
  }
  cancelWorkerRun(index);
  const args = getArgs(index);
  if (!args) {
    outputs[index] = [];
    solverViews[index] = {
      lines: [],
      rows: [],
      statusLine: '',
      statusKind: 'default',
    };
    applySolverSourceMessage(index, { type: 'status', text: '请输入参数', className: 'err' });
    saveState();
    return;
  }

  const params = new URLSearchParams({
    script: tabs[index].script,
    args,
  });
  const limit = globalLimit.value.trim();
  if (limit) params.set('limit', limit);

  running[index] = true;
  resetOutputOnNextSource[index] = true;
  startWorkerRun(index, args);
  const source = new EventSource(`/run?${params.toString()}`);
  sources[index] = source;

  source.onmessage = (event) => {
    if (sources[index] !== source) return;
    const message = JSON.parse(event.data);
    if (message.type === 'out') {
      applySolverSourceMessage(index, message);
    } else if (message.type === 'err') {
      applySolverSourceMessage(index, message);
    } else if (message.type === 'done') {
      applySolverSourceMessage(index, message);
      source.close();
      if (sources[index] === source) {
        sources[index] = null;
      }
      running[index] = false;
      saveState();
    }
  };

  source.onerror = () => {
    if (sources[index] !== source) return;
    source.close();
    if (sources[index] === source) {
      sources[index] = null;
    }
    running[index] = false;
    applySolverSourceMessage(index, { type: 'status', text: '[连接已关闭]', className: 'dim' });
    saveState();
  };

  saveState();
}

function setActiveTab(index) {
  activeTabIndex.value = Number.isInteger(index) && index >= 0 && index < tabs.length ? index : 0;
  ensurePanelRendered(activeTabIndex.value);
  syncLocationToTab(activeTabIndex.value);
  saveState();
}

function saveState() {
  if (isRestoring || isDiscardingPageState) return;
  try {
    window.localStorage.setItem(pageStateKey, JSON.stringify(buildSavedStateSnapshot()));
  } catch (_error) {
    // Page state is a convenience feature.
  }
}

function resetSolverTabState(index) {
  if (sources[index]) {
    sources[index].close();
    sources[index] = null;
  }
  cancelWorkerRun(index);
  running[index] = false;
  resetOutputOnNextSource[index] = false;
  filters[index] = '';
  outputs[index] = [];
  solverViews[index] = {
    lines: [],
    rows: [],
    statusLine: '',
    statusKind: 'default',
  };
  tableSorts[index] = { key: '', direction: 'asc' };
  const defaultValues = createTabValueState(tabs[index]);
  Object.keys(values[index]).forEach((key) => {
    values[index][key] = Object.prototype.hasOwnProperty.call(defaultValues, key)
      ? defaultValues[key]
      : '';
  });
}

function clearToolsPageState() {
  isDiscardingPageState = true;
  globalLimit.value = '';
  tabs.forEach((_tab, index) => {
    resetSolverTabState(index);
  });
  clearToolsPageStateStorage();
}

function restoreState() {
  const queryTabIndex = getTabIndexById(getLocationTabId());
  const { state: saved, migrated } = loadSavedState();

  isRestoring = true;
  try {
    const savedTabIndex = saved && typeof saved === 'object'
      ? (getTabIndexById(saved.activeTabId) ?? 0)
      : 0;
    activeTabIndex.value = queryTabIndex ?? savedTabIndex;
    ensurePanelRendered(activeTabIndex.value);
    if (!saved || typeof saved !== 'object') return;
    globalLimit.value = typeof saved.globalLimit === 'string' ? saved.globalLimit : '';

    tabs.forEach((tab, index) => {
      const filter = saved.filtersByTabId?.[tab.tabId];
      if (typeof filter === 'string') {
        filters[index] = filter;
      }
    });

    tabs.forEach((tab, index) => {
      const tabValues = saved.valuesByTabId?.[tab.tabId];
      if (!tabValues || typeof tabValues !== 'object' || !values[index]) return;
      const fieldsByKey = Object.fromEntries((tabs[index]?.fields || []).map(field => [field.key, field]));
      Object.keys(values[index]).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(tabValues, key)) {
          values[index][key] = coerceFieldValue(fieldsByKey[key] || {}, tabValues[key]);
        }
      });
    });

    tabs.forEach((tab, index) => {
      const lines = saved.outputsByTabId?.[tab.tabId];
      if (!Array.isArray(lines) || !outputs[index]) return;
      outputs[index] = lines
        .filter(line => line && typeof line.text === 'string')
        .map(line => makeLine(line.text, typeof line.className === 'string' ? line.className : ''));
      refreshSolverView(index);
    });
  } finally {
    isRestoring = false;
  }

  if (migrated) {
    saveState();
  }
}

watch([values, filters, globalLimit, activeTabIndex], saveState, { deep: true });

onMounted(() => {
  restoreState();
  window.addEventListener('pagehide', saveState);
  window.addEventListener(LEAVE_TOOLS_EVENT, clearToolsPageState);
});

onBeforeUnmount(() => {
  sources.forEach((source, index) => {
    if (source) {
      source.close();
      sources[index] = null;
    }
    cancelWorkerRun(index);
  });
  if (solverOutputWorker) {
    solverOutputWorker.terminate();
    solverOutputWorker = null;
  }
  window.removeEventListener('pagehide', saveState);
  window.removeEventListener(LEAVE_TOOLS_EVENT, clearToolsPageState);
});
</script>

<template>
  <TopBar active-page="tools" />

  <main class="elsa-page">
    <section class="elsa-head">
      <div>
        <h1>{{ t('tools.title') }}</h1>
        <p>{{ t(activeTab.titleKey) }}</p>
      </div>
      <div class="limit-control">
        <div class="limit-label-row">
          <label for="global-limit">{{ t('tools.limit') }}</label>
          <span class="help-tip">
            <button
              type="button"
              class="help-button"
              :aria-label="t('tools.limitHelpAria')"
              aria-describedby="global-limit-help"
            >?</button>
            <span id="global-limit-help" class="help-popover" role="tooltip">
              {{ t('tools.limitHelp') }}
            </span>
          </span>
        </div>
        <input id="global-limit" v-model="globalLimit" inputmode="numeric" autocomplete="off" :placeholder="t('tools.limitPlaceholder')">
      </div>
    </section>

    <section class="workspace">
      <aside class="tab-list" :aria-label="t('tools.modeNav')">
        <button
          v-for="(tab, index) in tabs"
          :key="tab.tabId"
          :class="{ 'tab-button': true, active: index === activeTabIndex }"
          type="button"
          @click="setActiveTab(index)"
        >
          {{ t(tab.titleKey) }}
        </button>
      </aside>

      <section class="tool-panel" :class="{ 'tool-panel--panel': activeTab.kind === 'panel' }">
        <template v-for="tab in panelTabs" :key="tab.tabId">
          <component
            :is="tab.component"
            v-if="renderedPanelTabs[tab.tabId]"
            v-show="activeTab.kind === 'panel' && activeTab.tabId === tab.tabId"
            v-bind="tab.tabId === 'ahmed' ? { embedded: true } : {}"
          />
        </template>
        <template v-if="activeTab.kind !== 'panel'">
          <header class="panel-head">
            <h2>{{ t(activeSolverTab.titleKey) }}</h2>
            <div class="panel-actions">
              <button class="action-button" type="button" @click="run(activeTabIndex)">{{ t('tools.calculate') }}</button>
              <button class="ghost-button" type="button" :disabled="!running[activeTabIndex]" @click="stop(activeTabIndex)">{{ t('tools.stop') }}</button>
            </div>
          </header>

          <div class="form-grid">
            <div v-for="field in activeSolverTab.fields" :key="field.key" class="field">
              <span>{{ t(field.labelKey) }}</span>
              <select v-if="field.type === 'select'" v-model="values[activeTabIndex][field.key]">
                <option v-for="option in field.options" :key="option.value" :value="option.value">{{ t(option.labelKey) }}</option>
              </select>
              <label v-else-if="field.type === 'switch'" class="switch-control">
                <input
                  v-model="values[activeTabIndex][field.key]"
                  type="checkbox"
                >
                <span class="switch-track" aria-hidden="true">
                  <span class="switch-thumb"></span>
                </span>
                <span class="switch-text">{{ values[activeTabIndex][field.key] ? t('tools.switchOn') : t('tools.switchOff') }}</span>
              </label>
              <input
                v-else
                v-model="values[activeTabIndex][field.key]"
                :inputmode="field.type"
                autocomplete="off"
                :placeholder="t(field.placeholderKey)"
              >
            </div>
          </div>

          <div class="result-toolbar">
            <label class="filter-control">
              <span>{{ t('tools.filter') }}</span>
              <input
                v-model="filters[activeTabIndex]"
                autocomplete="off"
                :placeholder="t('tools.filterPlaceholder')"
                @input="handleFilterChange(activeTabIndex)"
              >
            </label>
            <div
              v-if="usesTableOutput(activeTabIndex)"
              :class="getRunStatusClass(activeTabIndex)"
              role="status"
            >
              {{ getRunStatus(activeTabIndex) }}
            </div>
          </div>

          <div
            v-if="usesTableOutput(activeTabIndex)"
            :ref="el => { outputRefs[activeTabIndex] = el }"
            class="table-output"
            aria-live="polite"
          >
            <table v-if="getTableRows(activeTabIndex).length > 0" class="result-table">
              <thead>
                <tr>
                  <th
                    v-for="column in tableColumns"
                    :key="column.key"
                    :class="{ 'sortable-header': column.sortable }"
                  >
                    <button
                      v-if="column.sortable"
                      class="table-sort-button"
                      type="button"
                      @click="toggleTableSort(activeTabIndex, column.key)"
                    >
                      {{ t(column.labelKey) }}{{ getSortIndicator(activeTabIndex, column.key) }}
                    </button>
                    <span v-else>{{ t(column.labelKey) }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in getTableRows(activeTabIndex)" :key="row.id">
                  <td>{{ row.count }}</td>
                  <td>{{ row.totalCells }}</td>
                  <td>{{ row.totalPrice }}</td>
                  <td class="combo-cell">{{ row.combo }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-output">
              {{ t('tools.empty') }}
            </div>
          </div>

          <div v-else :ref="el => { outputRefs[activeTabIndex] = el }" class="output" aria-live="polite">
            <div
              v-for="line in getFilteredLines(activeTabIndex)"
              :key="line.id"
              class="line"
            >
              <span
                v-for="(segment, segmentIndex) in line.segments"
                :key="`${line.id}-${segmentIndex}`"
                :class="segment.className"
              >{{ segment.text }}</span>
            </div>
            <div v-if="getFilteredLines(activeTabIndex).length === 0" class="empty-output">
              {{ t('tools.empty') }}
            </div>
          </div>
        </template>
      </section>
    </section>
  </main>
</template>
