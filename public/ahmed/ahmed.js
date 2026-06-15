import {
  DEFAULT_GROUP_CELL_VALUES,
  DEFAULT_RED_CELL_VALUES,
  GROUPS,
  buildRedStats,
  compareItemNames,
  escapeHtml,
  formatMoney,
  getGroupKeyForQuality,
  getKnownConstraintLabel,
  getPinyinInitials,
  makeSizeKey,
  parseAverageValue,
  parseOptionalIntegerValue,
  parsePositiveIntegerValue,
  parseRequiredPositiveIntegerValue,
  parseTotalCellRangeValues,
  resolveTotalCells as resolveTotalCellsCore,
} from './ahmed-core.js';
import AhmedWorker from '../../src/ahmed/ahmed-worker.js?worker';

let groupCellValues = null;
let redCellValues = DEFAULT_RED_CELL_VALUES;
let itemsByGroup = null;
let allItems = [];
let itemById = new Map();
let redStatsBySize = [];
let redExpectedUnitPrice = null;
let averagePriceByQualitySize = null;
let currentAverages = null;
let currentGroupTargets = null;
let currentPriceAverages = null;
let currentTotalPrices = null;
let currentTotalCells = null;
let currentRows = [];
let knownConstraints = [];
let form = null;
let resultBody = null;
let resultMeta = null;
let clearButton = null;
let calculateButton = null;
let detailModal = null;
let detailSummary = null;
let detailBody = null;
let closeDetailButton = null;
let knownModeButtons = [];
let knownOutlineForm = null;
let knownExactForm = null;
let knownQualityInput = null;
let knownWidthInput = null;
let knownHeightInput = null;
let knownItemSearchInput = null;
let knownItemOptions = null;
let knownList = null;
let addOutlineConstraintButton = null;
let addExactConstraintButton = null;
let controllerRoot = null;
let pageState = null;
let activeControllerCleanup = null;
let activeMountToken = 0;
let ahmedWorker = null;
let ahmedWorkerCreationFailed = false;
let activeWorkerRunId = 0;
let nextWorkerRunId = 0;
let activeDetailRequestId = 0;
let nextDetailRequestId = 0;
let activeWorkerLimit = 100;
let currentResultRunId = 0;

let currentKnownMode = 'outline';
let hasCalculated = false;
let isRestoringPageState = false;
let isDiscardingPageState = false;
let pendingSavedState = pageState?.load() ?? null;
let lastMetaKey = 'loading';
let lastEmptyKey = 'noResults';

function toIdSelector(id) {
  const escaped = window.CSS && typeof window.CSS.escape === 'function'
    ? window.CSS.escape(id)
    : id;
  return `#${escaped}`;
}

const controllerMessages = {
  'zh-CN': {
    waiting: '等待输入',
    loading: '正在加载藏品数据',
    loadingRetry: '藏品数据正在加载，请稍后再试',
    noResults: '暂无结果',
    noCombination: '无匹配组合',
    cannotCalculate: '无法计算',
    noConstraints: '暂无约束',
    exactDuplicate: '该精确藏品已添加',
    noExactMatch: '没有找到匹配的藏品',
    fallback: message => `使用内置藏品格数数据，接口未加载：${message}`,
  },
  'en-US': {
    waiting: 'Waiting for input',
    loading: 'Loading collectible data',
    loadingRetry: 'Collectible data is still loading. Try again shortly.',
    noResults: 'No results',
    noCombination: 'No matching combination',
    cannotCalculate: 'Cannot calculate',
    noConstraints: 'No constraints',
    exactDuplicate: 'This exact item is already added',
    noExactMatch: 'No matching collectible found',
    fallback: message => `Using built-in cell data. API not loaded: ${message}`,
  },
};

function getLocale() {
  try {
    const locale = window.localStorage.getItem('bidking-locale');
    return locale === 'en-US' ? 'en-US' : 'zh-CN';
  } catch (_error) {
    return 'zh-CN';
  }
}

function tc(key, params = {}) {
  const message = controllerMessages[getLocale()][key] ?? controllerMessages['zh-CN'][key] ?? key;
  if (typeof message === 'function') return message(params.message ?? '');
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    message
  );
}

function queryWithin(root, selector) {
  return root && typeof root.querySelector === 'function'
    ? root.querySelector(selector)
    : null;
}

function queryAllWithin(root, selector) {
  return root && typeof root.querySelectorAll === 'function'
    ? [...root.querySelectorAll(selector)]
    : [];
}

function queryById(root, id) {
  return queryWithin(root, toIdSelector(id));
}

function requireById(root, id, label) {
  const element = queryById(root, id);
  if (!element) {
    throw new Error(`Ahmed controller missing ${label}`);
  }
  return element;
}

function resolveControllerRoot(root) {
  if (root && typeof root.querySelector === 'function') {
    return root;
  }
  throw new Error('mountAhmedController requires a DOM root with querySelector support');
}

function bindControllerElements(root) {
  controllerRoot = root;
  pageState = window.BidKingPageState?.create('ahmed') ?? null;
  form = requireById(root, 'combo-form', 'form');
  resultBody = requireById(root, 'result-body', 'result body');
  resultMeta = requireById(root, 'result-meta', 'result meta');
  clearButton = requireById(root, 'clear-results', 'clear button');
  calculateButton = requireById(root, 'calculate-button', 'calculate button');
  detailModal = requireById(root, 'detail-modal', 'detail modal');
  detailSummary = requireById(root, 'detail-summary', 'detail summary');
  detailBody = requireById(root, 'detail-body', 'detail body');
  closeDetailButton = requireById(root, 'close-detail', 'detail close button');
  knownModeButtons = queryAllWithin(root, '[data-known-mode]');
  knownOutlineForm = requireById(root, 'known-outline-form', 'known outline form');
  knownExactForm = requireById(root, 'known-exact-form', 'known exact form');
  knownQualityInput = requireById(root, 'known-quality', 'known quality input');
  knownWidthInput = requireById(root, 'known-width', 'known width input');
  knownHeightInput = requireById(root, 'known-height', 'known height input');
  knownItemSearchInput = requireById(root, 'known-item-search', 'known item search input');
  knownItemOptions = requireById(root, 'known-item-options', 'known item options');
  knownList = requireById(root, 'known-list', 'known constraints list');
  addOutlineConstraintButton = requireById(root, 'add-outline-constraint', 'outline constraint button');
  addExactConstraintButton = requireById(root, 'add-exact-constraint', 'exact constraint button');
}

function clearControllerElements() {
  form = null;
  resultBody = null;
  resultMeta = null;
  clearButton = null;
  calculateButton = null;
  detailModal = null;
  detailSummary = null;
  detailBody = null;
  closeDetailButton = null;
  knownModeButtons = [];
  knownOutlineForm = null;
  knownExactForm = null;
  knownQualityInput = null;
  knownWidthInput = null;
  knownHeightInput = null;
  knownItemSearchInput = null;
  knownItemOptions = null;
  knownList = null;
  addOutlineConstraintButton = null;
  addExactConstraintButton = null;
  controllerRoot = null;
  pageState = null;
}

function resetControllerState() {
  groupCellValues = null;
  redCellValues = DEFAULT_RED_CELL_VALUES;
  itemsByGroup = null;
  allItems = [];
  itemById = new Map();
  redStatsBySize = [];
  redExpectedUnitPrice = null;
  averagePriceByQualitySize = null;
  currentAverages = null;
  currentGroupTargets = null;
  currentPriceAverages = null;
  currentTotalPrices = null;
  currentTotalCells = null;
  currentRows = [];
  knownConstraints = [];
  currentKnownMode = 'outline';
  hasCalculated = false;
  isRestoringPageState = false;
  isDiscardingPageState = false;
  pendingSavedState = pageState?.load() ?? null;
  lastMetaKey = 'loading';
  lastEmptyKey = 'noResults';
  activeWorkerRunId = 0;
  activeDetailRequestId = 0;
  nextDetailRequestId = 0;
  activeWorkerLimit = 100;
  currentResultRunId = 0;
  ahmedWorkerCreationFailed = false;
}

function getControl(id) {
  return controllerRoot ? queryById(controllerRoot, id) : null;
}

function isControllerActive(token) {
  return token === activeMountToken && controllerRoot && form && calculateButton;
}

function releaseCurrentWorkerResultContext() {
  if (!ahmedWorker || !currentResultRunId) return;
  postAhmedWorkerMessage({
    type: 'release-run',
    runId: currentResultRunId,
  }, { allowCreate: false });
}

function markAhmedWorkerUnavailable(message = tc('cannotCalculate')) {
  currentRows = [];
  activeWorkerRunId = 0;
  activeDetailRequestId = 0;
  currentResultRunId = 0;
  closeDetail();
  setMeta(`<span class="err">${escapeHtml(message)}</span>`, 'cannotCalculate');
  setEmpty(tc('cannotCalculate'), 'cannotCalculate');
}

function handleAhmedWorkerError(error) {
  const message = error instanceof Error ? error.message : error?.message || String(error);
  terminateAhmedWorker();
  markAhmedWorkerUnavailable(message);
}

function handleAhmedWorkerMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'run-rows') {
    if (message.runId !== activeWorkerRunId) return;
    currentResultRunId = message.runId;
    currentRows = currentRows.concat(Array.isArray(message.rows) ? message.rows : []);
    if (currentRows.length) {
      renderResults(currentRows, Math.max(message.totalMatches ?? currentRows.length, currentRows.length), activeWorkerLimit, false);
      setMeta(`已找到 <strong>${message.totalMatches ?? currentRows.length}</strong> 条组合，正在继续计算…`);
    }
    savePageState();
    return;
  }

  if (message.type === 'run-progress') {
    if (message.runId !== activeWorkerRunId) return;
    if (!currentRows.length) {
      setMeta(`正在计算组合… 当前已命中 <strong>${message.totalMatches ?? 0}</strong> 条`);
    } else {
      setMeta(`已找到 <strong>${message.totalMatches ?? currentRows.length}</strong> 条组合，正在继续计算…`);
    }
    return;
  }

  if (message.type === 'run-complete') {
    if (message.runId !== activeWorkerRunId) return;
    currentResultRunId = message.runId;
    activeWorkerRunId = 0;
    hasCalculated = true;
    renderResults(currentRows, message.totalMatches ?? currentRows.length, activeWorkerLimit, Boolean(message.stoppedEarly));
    savePageState();
    return;
  }

  if (message.type === 'run-invalid') {
    if (message.runId !== activeWorkerRunId) return;
    activeWorkerRunId = 0;
    activeDetailRequestId = 0;
    currentResultRunId = 0;
    currentRows = [];
    setMeta('<span class="warn">当前已知藏品约束无法同时满足</span>');
    setEmpty(tc('noCombination'), 'noCombination');
    return;
  }

  if (message.type === 'run-no-combination') {
    if (message.runId !== activeWorkerRunId) return;
    activeWorkerRunId = 0;
    activeDetailRequestId = 0;
    currentResultRunId = 0;
    currentRows = [];
    const group = GROUPS.find((entry) => entry.key === message.groupKey);
    const label = group?.label ?? '当前分组';
    setMeta(`<span class="warn">${escapeHtml(label)} 没有可行件数</span>`);
    setEmpty(tc('noCombination'), 'noCombination');
    return;
  }

  if (message.type === 'run-error') {
    if (message.runId !== activeWorkerRunId) return;
    terminateAhmedWorker();
    markAhmedWorkerUnavailable(message.error || tc('cannotCalculate'));
    return;
  }

  if (message.type === 'detail-result') {
    const acceptedRunId = activeWorkerRunId || currentResultRunId;
    if (message.runId !== acceptedRunId) return;
    if (message.requestId !== activeDetailRequestId) return;
    activeDetailRequestId = 0;
    if (!message.detail) {
      clearDetailContent();
      detailModal.hidden = true;
      setMeta('<span class="warn">当前组合无法生成满足约束的具体物品明细</span>');
      return;
    }
    renderDetail(message.row, message.detail);
    detailModal.hidden = false;
    return;
  }

  if (message.type === 'detail-error') {
    const acceptedRunId = activeWorkerRunId || currentResultRunId;
    if (message.runId !== acceptedRunId) return;
    if (message.requestId !== activeDetailRequestId) return;
    activeDetailRequestId = 0;
    clearDetailContent();
    detailModal.hidden = true;
    setMeta(`<span class="err">${escapeHtml(message.error || tc('cannotCalculate'))}</span>`);
  }
}

function postAhmedWorkerMessage(message, options = {}) {
  const { retryOnFailure = false, allowCreate = true } = options;
  let worker = allowCreate ? ensureAhmedWorker() : ahmedWorker;
  if (!worker) return false;

  try {
    worker.postMessage(message);
    return true;
  } catch (_error) {
    terminateAhmedWorker();
    if (!retryOnFailure) {
      return false;
    }
    worker = allowCreate ? ensureAhmedWorker() : null;
    if (!worker) return false;
    try {
      worker.postMessage(message);
      return true;
    } catch (_retryError) {
      terminateAhmedWorker();
      return false;
    }
  }
}

function ensureAhmedWorker() {
  if (ahmedWorker) return ahmedWorker;

  if (ahmedWorkerCreationFailed) {
    return null;
  }

  try {
    ahmedWorker = new AhmedWorker();
  } catch (_error) {
    ahmedWorkerCreationFailed = true;
    return null;
  }

  ahmedWorker.onmessage = (event) => {
    handleAhmedWorkerMessage(event.data);
  };
  ahmedWorker.onerror = handleAhmedWorkerError;
  return ahmedWorker;
}

function terminateAhmedWorker() {
  if (!ahmedWorker) {
    activeWorkerRunId = 0;
    activeDetailRequestId = 0;
    currentResultRunId = 0;
    return;
  }
  ahmedWorker.terminate();
  ahmedWorker = null;
  activeWorkerRunId = 0;
  activeDetailRequestId = 0;
  currentResultRunId = 0;
}

function cancelActiveWorkerRun() {
  if (ahmedWorker && activeWorkerRunId) {
    postAhmedWorkerMessage({
      type: 'cancel-run',
      runId: activeWorkerRunId,
    }, { allowCreate: false });
  }
  activeWorkerRunId = 0;
  activeDetailRequestId = 0;
}

function buildComputeStateSnapshot() {
  return {
    groupCellValues,
    redCellValues,
    itemsByGroup,
    allItems,
    redStatsBySize,
    averagePriceByQualitySize,
    knownConstraints,
    averages: currentAverages,
    groupTargets: currentGroupTargets,
    priceAverages: currentPriceAverages,
    totalPrices: currentTotalPrices,
    totalCells: currentTotalCells,
  };
}

function savePageState() {
  if (!pageState || isRestoringPageState || isDiscardingPageState || !controllerRoot) return;

  pageState.save({
    controls: pageState.collectControls(controllerRoot),
    knownConstraints,
    currentKnownMode,
    hasCalculated,
    currentRows,
  });
}

function restoreSavedState() {
  if (!pageState || !pendingSavedState || !controllerRoot) return false;

  const saved = pendingSavedState;
  pendingSavedState = null;
  isRestoringPageState = true;
  try {
    if (saved.controls) {
      pageState.restoreControls(saved.controls, controllerRoot);
    }

    knownConstraints = Array.isArray(saved.knownConstraints)
      ? saved.knownConstraints.map(constraint => ({ ...constraint }))
      : [];
    currentKnownMode = saved.currentKnownMode === 'exact' ? 'exact' : 'outline';
    hasCalculated = Boolean(saved.hasCalculated);
    currentRows = Array.isArray(saved.currentRows) ? saved.currentRows.slice() : [];

    setKnownMode(currentKnownMode);
    renderKnownConstraints();
    renderExactOptions(knownItemSearchInput?.value ?? '');
  } finally {
    isRestoringPageState = false;
  }

  return true;
}

function setMeta(html, key = null) {
  if (!resultMeta) return;
  lastMetaKey = key;
  resultMeta.innerHTML = html;
}

function setEmpty(text = tc('noResults'), key = 'noResults') {
  if (!resultBody) return;
  lastEmptyKey = key;
  resultBody.innerHTML = `<tr><td colspan="9" class="empty">${escapeHtml(text)}</td></tr>`;
}

function parseAverage(input) {
  return parseAverageValue(input.value, input.previousElementSibling.textContent);
}

function resolveTotalCellsForController(avg, totalCount, totalCells) {
  return resolveTotalCellsCore(avg, totalCount, totalCells);
}

function parsePositiveInteger(input, name) {
  return parsePositiveIntegerValue(input.value, name);
}

function parseOptionalInteger(input) {
  if (!input) return null;
  return parseOptionalIntegerValue(input.value, input.previousElementSibling.textContent);
}

function parseRequiredPositiveInteger(input) {
  return parseRequiredPositiveIntegerValue(input.value, input.previousElementSibling.textContent);
}

function parseTotalCellRange(minInput, maxInput) {
  const min = parseOptionalInteger(minInput);
  const max = parseOptionalInteger(maxInput);

  return parseTotalCellRangeValues(min, max);
}

function renderResults(rows, totalMatches, limit, stoppedEarly) {
  if (totalMatches === 0) {
    setMeta('<span class="warn">没有找到匹配组合</span>');
    setEmpty('无匹配组合');
    return;
  }

  if (stoppedEarly) {
    setMeta(`按优先级显示前 <strong>${rows.length}</strong> 条组合，可能还有更多`);
  } else {
    setMeta(`共找到 <strong>${totalMatches}</strong> 条组合`);
  }

  const html = rows.map(row => {
    const redClass = row.red === 0 ? 'red-low' : row.red <= 3 ? 'red-mid' : 'red-high';
    const index = currentRows.indexOf(row);
    const totalExpected = row.expectedTotal === null || row.redExpectedTotal === null
      ? null
      : row.expectedTotal + row.redExpectedTotal;
    return `<tr>
      <td>${row.wg}</td>
      <td>${row.blue}</td>
      <td>${row.purple}</td>
      <td>${row.orange}</td>
      <td class="${redClass}">${row.red}</td>
      <td class="price-cell">${row.expectedTotal === null ? '-' : formatMoney(Math.round(row.expectedTotal))}</td>
      <td class="price-cell">${row.redExpectedTotal === null ? '-' : formatMoney(Math.round(row.redExpectedTotal))}</td>
      <td class="price-cell">${totalExpected === null ? '-' : formatMoney(Math.round(totalExpected))}</td>
      <td><button type="button" class="mini-button" data-detail-index="${index}">查看</button></td>
    </tr>`;
  }).join('');

  resultBody.innerHTML = html;
}

function renderRedReference(row) {
  if (row.red === 0) {
    return `<article class="detail-section red-reference">
      <h3>红色轮廓参考：该组合不需要红色藏品</h3>
    </article>`;
  }

  if (!redStatsBySize.length) {
    return `<article class="detail-section red-reference">
      <h3>红色轮廓参考：暂无红色藏品数据</h3>
    </article>`;
  }

  const rows = redStatsBySize.map(stat => `<tr>
    <td>${escapeHtml(stat.sizeKey)}</td>
    <td>${stat.count}</td>
    <td>${escapeHtml(stat.min.name)} · ${formatMoney(stat.min.price)}</td>
    <td>${escapeHtml(stat.median.name)} · ${formatMoney(stat.median.price)}</td>
    <td>${escapeHtml(stat.max.name)} · ${formatMoney(stat.max.price)}</td>
    <td>${formatMoney(Math.round(stat.expectedPrice))}</td>
  </tr>`).join('');

  return `<article class="detail-section red-reference">
    <h3>红色轮廓参考：该组合需要 ${row.red} 件红色藏品，当前取最低预期单价 ${redExpectedUnitPrice === null ? '-' : formatMoney(Math.round(redExpectedUnitPrice))}</h3>
    <div class="reference-table-wrap">
      <table class="reference-table">
        <thead>
          <tr>
            <th>长x宽</th>
            <th>数量</th>
            <th>最低价</th>
            <th>中位数</th>
            <th>最高价</th>
            <th>预期单价</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </article>`;
}

function renderDetail(row, detail) {
  if (!detailSummary || !detailBody) return;
  const expectedText = row.expectedTotal === null ? '' : `，不含红预期总价 ${formatMoney(Math.round(row.expectedTotal))}`;
  const redTargetText = row.redTargetCells == null ? '' : `，红色目标格数 ${row.redTargetCells}`;
  detailSummary.textContent = `白+绿 ${row.wg} / 蓝 ${row.blue} / 紫 ${row.purple} / 橙/金 ${row.orange} / 红 ${row.red}，实际样例总价 ${formatMoney(detail.totalPrice)}，总格数 ${detail.totalCells}${redTargetText}${expectedText}`;

  const sectionsHtml = detail.sections.map(section => {
    const target = section.target === null ? '' : `，目标格数 ${section.target}`;
    const items = section.items.length === 0
      ? '<li class="detail-empty">无</li>'
      : section.items.map(item => {
        const expected = item.expectedPrice === undefined || item.expectedPrice === null
          ? ''
          : ` · 预期 ${formatMoney(Math.round(item.expectedPrice))}`;
        return `<li>
          <span>${escapeHtml(item.name)}</span>
          <span>${escapeHtml(item.quality)} · ${escapeHtml(item.sizeKey)} · ${item.cells}格 · ${formatMoney(item.price)}${expected}</span>
        </li>`;
      }).join('');

    return `<article class="detail-section">
      <h3>${escapeHtml(section.label)}：${section.count} 件${target}，小计 ${formatMoney(section.price)}${section.expectedPrice === null ? '' : `，预期 ${formatMoney(Math.round(section.expectedPrice))}`}</h3>
      <ul>${items}</ul>
    </article>`;
  }).join('');

  detailBody.innerHTML = renderRedReference(row) + sectionsHtml;
}

function clearDetailContent() {
  if (detailSummary) {
    detailSummary.textContent = '';
  }
  if (detailBody) {
    detailBody.innerHTML = '';
  }
}

function openDetail(index) {
  if (!detailModal) return;
  const row = currentRows[index];
  if (!row) return;
  const runId = currentResultRunId;
  if (!runId) return;
  if (!ahmedWorker) {
    markAhmedWorkerUnavailable();
    return;
  }

  clearDetailContent();
  detailModal.hidden = true;
  activeDetailRequestId = ++nextDetailRequestId;
  if (!postAhmedWorkerMessage({
    type: 'open-detail',
    runId,
    requestId: activeDetailRequestId,
    row,
  }, { allowCreate: false })) {
    markAhmedWorkerUnavailable();
  }
}

function closeDetail() {
  if (!detailModal) return;
  activeDetailRequestId = 0;
  detailModal.hidden = true;
}

function insertTextAtCursor(input, text) {
  const value = input.value;

  try {
    const start = input.selectionStart;
    const end = input.selectionEnd;

    if (typeof start === 'number' && typeof end === 'number') {
      input.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
      const nextCursor = start + text.length;
      input.setSelectionRange(nextCursor, nextCursor);
    } else {
      input.value = `${value}${text}`;
    }
  } catch {
    input.value = `${value}${text}`;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleInputShortcut(event) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key !== '`' && event.code !== 'Backquote') return;

  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.disabled || input.readOnly) return;

  event.preventDefault();
  insertTextAtCursor(input, '.');
}

function fillInputValue(input, nextValue) {
  if (!input || input.value === nextValue) {
    return false;
  }

  input.value = nextValue;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function renderKnownConstraints() {
  if (!knownList) return;
  if (!knownConstraints.length) {
    knownList.textContent = tc('noConstraints');
    return;
  }

  knownList.innerHTML = knownConstraints.map(constraint => `<span class="known-chip">
    ${escapeHtml(getKnownConstraintLabel(constraint))}
    <button type="button" data-remove-known="${escapeHtml(constraint.id)}" aria-label="删除约束">×</button>
  </span>`).join('');
}

function setKnownMode(mode) {
  currentKnownMode = mode === 'exact' ? 'exact' : 'outline';
  knownModeButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.knownMode === currentKnownMode);
  });
  if (knownOutlineForm) {
    knownOutlineForm.hidden = currentKnownMode !== 'outline';
  }
  if (knownExactForm) {
    knownExactForm.hidden = currentKnownMode !== 'exact';
  }
  if (!isRestoringPageState) savePageState();
}

function rerunIfCalculated() {
  if (!currentAverages || !hasCalculated) return;
  if (!getControl('total-count')?.value.trim()) return;
  form.requestSubmit();
}

function addKnownConstraint(constraint) {
  knownConstraints.push({
    ...constraint,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
  renderKnownConstraints();
  savePageState();
  rerunIfCalculated();
}

function addOutlineConstraint() {
  try {
    const quality = knownQualityInput.value;
    const width = parseRequiredPositiveInteger(knownWidthInput);
    const height = parseRequiredPositiveInteger(knownHeightInput);
    const sizeKey = makeSizeKey(width, height);
    const groupKey = getGroupKeyForQuality(quality);
    const cells = width * height;

    if (!groupKey) throw new Error('品质无效');
    if (allItems.length && !allItems.some(item => item.quality === quality && item.sizeKey === sizeKey)) {
      throw new Error('没有找到该品质和轮廓的藏品');
    }

    addKnownConstraint({ type: 'outline', quality, groupKey, sizeKey, cells });
    knownWidthInput.value = '';
    knownHeightInput.value = '';
    savePageState();
  } catch (err) {
    setMeta(`<span class="err">${escapeHtml(err.message)}</span>`);
  }
}

function searchExactItems(query) {
  const text = query.trim().toLowerCase();
  if (!text) return [...allItems];

  return [...allItems]
    .filter(item => item.name.toLowerCase().includes(text) || item.initials.includes(text))
    .sort((a, b) => {
      const exact = Number(b.name.toLowerCase() === text) - Number(a.name.toLowerCase() === text);
      if (exact !== 0) return exact;
      const initialExact = Number(b.initials === text) - Number(a.initials === text);
      if (initialExact !== 0) return initialExact;
      const initialStarts = Number(b.initials.startsWith(text)) - Number(a.initials.startsWith(text));
      if (initialStarts !== 0) return initialStarts;
      return a.name.length - b.name.length || compareItemNames(a, b);
    });
}

function findExactItem(query) {
  return searchExactItems(query)[0] ?? null;
}

function addExactConstraint() {
  const item = findExactItem(knownItemSearchInput.value);
  if (!item) {
    setMeta(`<span class="err">${escapeHtml(tc('noExactMatch'))}</span>`, 'noExactMatch');
    return;
  }

  addKnownConstraint({
    type: 'exact',
    name: item.name,
    quality: item.quality,
    groupKey: item.groupKey,
    sizeKey: item.sizeKey,
    cells: item.cells,
    price: item.price,
    itemId: item.id,
  });
  knownItemSearchInput.value = '';
  renderExactOptions('');
  savePageState();
}

function addExactItem(item) {
  addKnownConstraint({
    type: 'exact',
    name: item.name,
    quality: item.quality,
    groupKey: item.groupKey,
    sizeKey: item.sizeKey,
    cells: item.cells,
    price: item.price,
    itemId: item.id,
  });
  knownItemSearchInput.value = '';
  renderExactOptions('');
  savePageState();
}

function renderExactOptions(query) {
  if (!knownItemOptions) return;
  const matches = searchExactItems(query).slice(0, 40);

  knownItemOptions.innerHTML = matches.map(item => `<button type="button" class="known-suggestion" data-known-item-id="${escapeHtml(item.id)}">
    <span>${escapeHtml(item.name)}</span>
    <span>${escapeHtml(item.initials)} · ${escapeHtml(item.quality)} · ${escapeHtml(item.sizeKey)} · ${formatMoney(item.price)}</span>
  </button>`).join('');
}

async function loadData() {
  const [collectiblesResponse, averagePricesResponse] = await Promise.all([
    fetch('/data/collectibles.json', { cache: 'no-store' }),
    fetch('/data/quality-size-average-prices.json', { cache: 'no-store' }),
  ]);

  if (!collectiblesResponse.ok) throw new Error(`collectibles HTTP ${collectiblesResponse.status}`);
  if (!averagePricesResponse.ok) throw new Error(`average prices HTTP ${averagePricesResponse.status}`);

  const data = await collectiblesResponse.json();
  const averagePrices = await averagePricesResponse.json();
  const valuesByGroup = Object.fromEntries(GROUPS.map(group => [group.key, new Set()]));
  const itemsByKey = Object.fromEntries([...GROUPS.map(group => [group.key, []]), ['red', []]]);
  const nextItemById = new Map();

  const nextAllItems = data.map((item, index) => {
    const cells = item.size.width * item.size.height;
    const sizeKey = item.size.key || makeSizeKey(item.size.width, item.size.height);
    const entry = {
      id: String(index),
      name: item.name,
      quality: item.quality,
      groupKey: getGroupKeyForQuality(item.quality),
      price: item.price,
      cells,
      sizeKey,
      initials: getPinyinInitials(item.name),
    };
    nextItemById.set(entry.id, entry);
    return entry;
  });

  for (const item of nextAllItems) {
    if (!item.groupKey) continue;
    if (item.groupKey === 'red') {
      itemsByKey.red.push(item);
      continue;
    }

    itemsByKey[item.groupKey].push(item);
    valuesByGroup[item.groupKey].add(item.cells);
  }

  for (const group of GROUPS) {
    valuesByGroup[group.key] = [...valuesByGroup[group.key]].sort((a, b) => a - b);
  }

  const nextRedCellValues = [...new Set(itemsByKey.red.map(item => item.cells))].sort((a, b) => a - b);
  const nextRedStatsBySize = buildRedStats(itemsByKey.red);
  const nextRedExpectedUnitPrice = nextRedStatsBySize.length
    ? Math.min(...nextRedStatsBySize.map(stat => stat.expectedPrice))
    : null;

  return {
    groupCellValues: valuesByGroup,
    redCellValues: nextRedCellValues,
    itemsByGroup: itemsByKey,
    allItems: nextAllItems,
    itemById: nextItemById,
    redStatsBySize: nextRedStatsBySize,
    redExpectedUnitPrice: nextRedExpectedUnitPrice,
    averagePriceByQualitySize: averagePrices,
  };
}

function applyLoadedData(loadedData) {
  groupCellValues = loadedData.groupCellValues;
  redCellValues = loadedData.redCellValues;
  itemsByGroup = loadedData.itemsByGroup;
  allItems = loadedData.allItems;
  itemById = loadedData.itemById;
  redStatsBySize = loadedData.redStatsBySize;
  redExpectedUnitPrice = loadedData.redExpectedUnitPrice;
  averagePriceByQualitySize = loadedData.averagePriceByQualitySize;
  renderExactOptions('');
}

function addManagedListener(cleanups, target, type, handler, options) {
  target.addEventListener(type, handler, options);
  cleanups.push(() => {
    target.removeEventListener(type, handler, options);
  });
}

export function mountAhmedController(root = document) {
  activeControllerCleanup?.();

  const resolvedRoot = resolveControllerRoot(root);
  bindControllerElements(resolvedRoot);
  resetControllerState();
  const mountToken = ++activeMountToken;
  const cleanups = [];

  const handleSubmit = (event) => {
    event.preventDefault();

    try {
      if (!groupCellValues) {
        setMeta(`<span class="warn">${escapeHtml(tc('loadingRetry'))}</span>`, 'loadingRetry');
        return;
      }

      const totalCount = parsePositiveInteger(getControl('total-count'), '藏品总件数');
      const totalAverage = parseAverage(getControl('avg-all'));
      const inputTotalCells = parseOptionalInteger(getControl('total-cells-all'));
      const totalCells = resolveTotalCellsForController(totalAverage, totalCount, inputTotalCells);
      const totalCellRange = parseTotalCellRange(
        getControl('min-cells-all'),
        getControl('max-cells-all')
      );
      const limit = Math.max(1, parsePositiveInteger(getControl('result-limit'), '最多显示'));
      const inputAverages = Object.fromEntries(GROUPS.map(group => [
        group.key,
        parseAverage(getControl(group.inputId)),
      ]));
      const priceAverages = Object.fromEntries(GROUPS.map(group => [
        group.key,
        parseAverage(getControl(group.priceAverageInputId)),
      ]));
      const totalPrices = Object.fromEntries(GROUPS.map(group => [
        group.key,
        parseOptionalInteger(group.totalPriceInputId ? getControl(group.totalPriceInputId) : null),
      ]));
      const totalCellsByGroup = Object.fromEntries(GROUPS.map(group => [
        group.key,
        parseOptionalInteger(group.totalCellsInputId ? getControl(group.totalCellsInputId) : null),
      ]));
      const countsByGroup = Object.fromEntries(GROUPS.map(group => [
        group.key,
        parseOptionalInteger(group.countInputId ? getControl(group.countInputId) : null),
      ]));
      const redCount = parseOptionalInteger(getControl('count-red'));
      const redAverage = parseAverage(getControl('avg-red'));

      const missingTargetGroup = GROUPS.find(group =>
        !inputAverages[group.key] && totalCellsByGroup[group.key] === null
      );
      if (missingTargetGroup) {
        throw new Error(`${missingTargetGroup.label} 需要填写平均格数或总格数`);
      }

      const averages = Object.fromEntries(GROUPS.map(group => [
        group.key,
        inputAverages[group.key],
      ]));

      currentAverages = averages;
      currentGroupTargets = totalCellsByGroup;
      currentPriceAverages = priceAverages;
      currentTotalPrices = totalPrices;
      currentTotalCells = totalCells;
      cancelActiveWorkerRun();
      releaseCurrentWorkerResultContext();
      closeDetail();
      currentRows = [];
      currentResultRunId = 0;
      hasCalculated = true;
      activeWorkerLimit = limit;
      savePageState();
      setMeta('正在计算组合…');
      setEmpty();

      const runId = ++nextWorkerRunId;
      activeWorkerRunId = runId;
      currentResultRunId = runId;
      if (!postAhmedWorkerMessage({
        type: 'start-run',
        runId,
        search: {
          totalCount,
          limit,
          redCount,
          totalCells,
          redAverage,
          totalCellRange,
          countsByGroup,
          totalCellsByGroup,
        },
        computeState: buildComputeStateSnapshot(),
      }, { retryOnFailure: true })) {
        markAhmedWorkerUnavailable();
        return;
      }
      activeWorkerRunId = runId;
      currentResultRunId = runId;
    } catch (err) {
      setMeta(`<span class="err">${escapeHtml(err.message)}</span>`);
      setEmpty(tc('cannotCalculate'), 'cannotCalculate');
    }
  };

  const resetMountedState = ({ clearPersistedState = false } = {}) => {
    isDiscardingPageState = clearPersistedState;
    isRestoringPageState = true;
    form.reset();
    currentAverages = null;
    currentGroupTargets = null;
    currentPriceAverages = null;
    currentTotalPrices = null;
    currentTotalCells = null;
    currentRows = [];
    knownConstraints = [];
    hasCalculated = false;
    currentKnownMode = 'outline';
    cancelActiveWorkerRun();
    releaseCurrentWorkerResultContext();
    currentResultRunId = 0;
    renderKnownConstraints();
    setKnownMode('outline');
    knownWidthInput.value = '';
    knownHeightInput.value = '';
    knownItemSearchInput.value = '';
    renderExactOptions('');
    const resultLimitInput = getControl('result-limit');
    if (resultLimitInput) {
      resultLimitInput.value = 100;
    }
    closeDetail();
    setMeta(groupCellValues ? tc('waiting') : tc('loading'), groupCellValues ? 'waiting' : 'loading');
    setEmpty();
    isRestoringPageState = false;
    if (clearPersistedState) {
      pageState?.clear();
      return;
    }
    savePageState();
  };

  const handleClear = () => {
    resetMountedState();
  };

  const handleResultClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-detail-index]') : null;
    if (!button) return;
    openDetail(Number(button.dataset.detailIndex));
  };

  const handleDetailClick = (event) => {
    if (event.target instanceof Element && event.target.matches('[data-close-detail]')) {
      closeDetail();
    }
  };

  const handleKnownSearchInput = () => {
    renderExactOptions(knownItemSearchInput.value);
    savePageState();
  };

  const handleKnownOptionsClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-known-item-id]') : null;
    if (!button) return;
    const item = itemById.get(button.dataset.knownItemId);
    if (item) addExactItem(item);
  };

  const handleKnownListClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-remove-known]') : null;
    if (!button) return;
    knownConstraints = knownConstraints.filter(constraint => constraint.id !== button.dataset.removeKnown);
    renderKnownConstraints();
    savePageState();
    rerunIfCalculated();
  };

  const handleRootInput = (event) => {
    if (
      event.target instanceof HTMLInputElement
      || event.target instanceof HTMLSelectElement
      || event.target instanceof HTMLTextAreaElement
    ) {
      if (!isRestoringPageState) savePageState();
    }
  };

  const handleRootChange = () => {
    if (!isRestoringPageState) savePageState();
  };

  const handleLocaleChange = () => {
    renderKnownConstraints();
    if (!currentRows.length && lastEmptyKey) {
      setEmpty(tc(lastEmptyKey), lastEmptyKey);
    }
    if (lastMetaKey && controllerMessages[getLocale()][lastMetaKey]) {
      const className = ['loadingRetry', 'fallback', 'exactDuplicate'].includes(lastMetaKey) ? 'warn'
        : lastMetaKey === 'noExactMatch' ? 'err'
          : '';
      const text = tc(lastMetaKey);
      setMeta(className ? `<span class="${className}">${escapeHtml(text)}</span>` : escapeHtml(text), lastMetaKey);
    }
  };

  const handleKeyDown = (event) => {
    handleInputShortcut(event);
    if (event.key === 'Escape' && detailModal && !detailModal.hidden) {
      closeDetail();
    }
  };

  addManagedListener(cleanups, form, 'submit', handleSubmit);
  addManagedListener(cleanups, clearButton, 'click', handleClear);
  addManagedListener(cleanups, resultBody, 'click', handleResultClick);
  addManagedListener(cleanups, closeDetailButton, 'click', closeDetail);
  addManagedListener(cleanups, detailModal, 'click', handleDetailClick);
  knownModeButtons.forEach((button) => {
    addManagedListener(cleanups, button, 'click', () => setKnownMode(button.dataset.knownMode));
  });
  addManagedListener(cleanups, addOutlineConstraintButton, 'click', addOutlineConstraint);
  addManagedListener(cleanups, addExactConstraintButton, 'click', addExactConstraint);
  addManagedListener(cleanups, knownItemSearchInput, 'input', handleKnownSearchInput);
  addManagedListener(cleanups, knownItemOptions, 'click', handleKnownOptionsClick);
  addManagedListener(cleanups, knownList, 'click', handleKnownListClick);
  addManagedListener(cleanups, controllerRoot, 'input', handleRootInput, true);
  addManagedListener(cleanups, controllerRoot, 'change', handleRootChange, true);
  addManagedListener(cleanups, window, 'pagehide', savePageState);
  addManagedListener(cleanups, window, 'bidking-locale-change', handleLocaleChange);
  addManagedListener(cleanups, controllerRoot, 'keydown', handleKeyDown);

  setMeta(tc('loading'), 'loading');
  setEmpty();
  calculateButton.disabled = true;

  const cleanup = () => {
    if (activeControllerCleanup !== cleanup) return;
    activeMountToken += 1;
    cancelActiveWorkerRun();
    terminateAhmedWorker();
    closeDetail();
    for (const stop of cleanups.reverse()) {
      stop();
    }
    activeControllerCleanup = null;
    clearControllerElements();
  };

  cleanup.resetState = () => {
    if (activeControllerCleanup !== cleanup) return;
    resetMountedState({ clearPersistedState: true });
  };

  activeControllerCleanup = cleanup;

  loadData()
    .then((loadedData) => {
      if (!isControllerActive(mountToken)) return;
      applyLoadedData(loadedData);
      calculateButton.disabled = false;
      setMeta(tc('waiting'), 'waiting');
      restoreSavedState();
      if (hasCalculated && getControl('total-count')?.value.trim()) {
        try {
          form.requestSubmit();
        } catch (_error) {
          // Ignore if submit is unavailable in this environment.
        }
      }
    })
    .catch(err => {
      if (!isControllerActive(mountToken)) return;
      groupCellValues = DEFAULT_GROUP_CELL_VALUES;
      redCellValues = DEFAULT_RED_CELL_VALUES;
      allItems = [];
      itemById = new Map();
      redStatsBySize = [];
      redExpectedUnitPrice = null;
      averagePriceByQualitySize = null;
      itemsByGroup = null;
      calculateButton.disabled = false;
      setMeta(`<span class="warn">${escapeHtml(tc('fallback', { message: err.message }))}</span>`, 'fallback');
      setEmpty();
      restoreSavedState();
      if (hasCalculated && getControl('total-count')?.value.trim()) {
        try {
          form.requestSubmit();
        } catch (_error) {
          // Ignore if submit is unavailable in this environment.
        }
      }
    });

  return cleanup;
}
