import { computed, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  buildPriceProfilesByGroup,
  collectEstimationInputs,
  estimateGroupValue,
  estimateTotalByStage,
  findMatchingTotalPriceCounts,
  findTotalForAveragePrice,
  getEffectiveMaxCells,
  getFeasibleCellsFromAverage,
  parseOptionalNumber,
  prepareCollectibleItemsForGroup,
  resolveAutoTotalCellsFromAverage,
} from '../ethan/estimator.js';
import {
  createMonitorCells,
  parseSlotType,
} from '../ethan/monitor-grid.js';
import { useI18n } from '../shared/i18n.js';
import { LEAVE_TOOLS_EVENT } from '../shared/tools-page-lifecycle.js';
import { createMonitorProfileAdapter } from './monitor-profile-adapter.js';
import {
  buildCombinedPredictionRow,
  buildPredictionRow,
  withAverageMatchTags,
} from './result-row-builder.js';
import {
  inferProfileIdFromRawMonitorEvent,
  resolveGroupKeyFromQuality,
} from './hero-profiles.js';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';
import { resetElsaEstimateState, syncElsaEstimateState } from '../elsa/elsaEstimateState.js';

const PREDICTION_OUTPUT_LIMIT = 30;
const PRICE_COMBO_MIN_CELL_SPACING = 4;

export function useHeroEstimatorPanel(profile) {
  const { t, locale } = useI18n();
  const groups = profile.groups;
  const predictionConfigs = profile.streamSearchConfigs ?? [];
  const monitorAdapter = createMonitorProfileAdapter(profile);
  const monitorRuntime = useMonitorSwitch();
  const heroKey = (suffix) => `${profile.messageNs}.${suffix}`;
  const globalFields = [
    {
      key: 'totalCells',
      id: 'total-cells-all',
      labelKey: heroKey('fields.totalCells'),
      mode: 'numeric',
      placeholderKey: heroKey('optional'),
    },
    {
      key: 'totalAverage',
      id: 'avg-all',
      labelKey: heroKey('fields.totalAverage'),
      mode: 'decimal',
      placeholderKey: heroKey('optional'),
    },
  ];
  const qualityFields = [
    { key: 'avg', prefix: 'avg', suffixKey: heroKey('fields.avg'), mode: 'decimal' },
    { key: 'cells', prefix: 'cells', suffixKey: heroKey('fields.cells'), mode: 'numeric' },
    { key: 'priceAverage', prefix: 'price', suffixKey: heroKey('fields.priceAverage'), mode: 'decimal' },
  ];
  const resultColumns = [
    { key: 'label', labelKey: heroKey('columns.label') },
    { key: 'count', labelKey: heroKey('columns.count') },
    { key: 'cells', labelKey: heroKey('columns.cells') },
    { key: 'avg', labelKey: heroKey('columns.avg') },
    { key: 'low', labelKey: heroKey('columns.low') },
    { key: 'mean', labelKey: heroKey('columns.mean') },
    { key: 'high', labelKey: heroKey('columns.high') },
    { key: 'status', labelKey: heroKey('columns.status') },
  ];

  const globalInputs = reactive({
    totalCells: '',
    totalAverage: '',
  });

  const groupInputs = reactive(Object.fromEntries(groups.map((group) => [
    group.key,
    { avg: '', cells: '', priceAverage: '', totalPrice: '' },
  ])));

  const groupPlaceholders = reactive(Object.fromEntries(groups.map((group) => [
    group.key,
    { avg: '', cells: '', priceAverage: '', totalPrice: '' },
  ])));
  const globalPlaceholders = reactive({
    totalAverage: '',
  });

  const totalCellOptions = ref([]);
  const totalAverageOptionSource = ref('');
  const averagePricesByQuality = ref(null);
  const priceProfilesByGroup = ref(null);
  const collectibleItemsByGroup = ref({});
  const collectibleItems = ref([]);
  const isLoading = ref(true);
  const hasCalculated = ref(false);
  const isRestoring = ref(false);
  const metaText = ref('');
  const metaStatus = ref('');
  const metaErrorKind = ref('');
  const summary = reactive({
    total: null,
    low: null,
    high: null,
  });
  const tableRows = ref([]);
  const lastState = ref(null);
  const monitorStatus = monitorRuntime.status;
  const monitorGridState = ref(monitorAdapter.createState());
  const monitorCells = createMonitorCells();
  const selectedMonitorOutline = ref(null);
  let priceSearchSource = null;
  let activeEstimationWorker = null;
  let pendingEstimateRefreshTimer = null;
  let priceSearchRunId = 0;
  let estimationRunId = 0;
  let activeMonitorGameUid = null;
  let activeMonitorProfileId = profile.id === 'ethan' ? 'ethan' : null;
  let pausedMonitorGameUid = null;
  let removeMonitorSubscription = null;
  let isDiscardingPageState = false;
  const appliedMonitorEventKeys = new Set();
  let clearedMonitorEventKeys = new Set();

  const summaryCards = computed(() => [
    { key: 'total', id: 'total-estimate', label: t(heroKey('cards.total')), value: formatMoney(summary.total) },
    { key: 'low', id: 'low-estimate', label: t(heroKey('cards.low')), value: formatMoney(summary.low) },
    { key: 'high', id: 'high-estimate', label: t(heroKey('cards.high')), value: formatMoney(summary.high) },
  ]);

  const usesTotalCellSelect = computed(() => totalCellOptions.value.length > 0);
  const monitorStatusText = monitorRuntime.statusText;
  const monitorErrorText = computed(() => monitorRuntime.errorText.value || monitorStatus.value.lastError?.message || monitorStatus.value.lastError || '');
  const monitorMinimumOccupied = computed(() => monitorGridState.value.minimumOccupied);
  const monitorEstimatedTotalCells = computed(() => formatMonitorInputNumber(monitorMinimumOccupied.value?.minTotalCells));
  const normalizedAutoTotalCells = computed(() => {
    const rawCells = monitorEstimatedTotalCells.value;
    if (!rawCells) return '';

    const averageSource = String(globalInputs.totalAverage).trim() || globalPlaceholders.totalAverage;
    if (!averageSource) return '';

    let average = null;
    try {
      average = parseOptionalNumber(averageSource, t(heroKey('fields.totalAverage')));
    } catch (_error) {
      return '';
    }
    if (average === null) return '';

    const preferredCells = Number(rawCells);
    if (!Number.isFinite(preferredCells)) return '';

    const normalizedCells = resolveAutoTotalCellsFromAverage(average, preferredCells);
    return normalizedCells === null ? '' : String(normalizedCells);
  });
  const selectedTotalCellsValue = computed({
    get() {
      return String(globalInputs.totalCells).trim() || normalizedAutoTotalCells.value;
    },
    set(value) {
      globalInputs.totalCells = value;
    },
  });
  const totalCellsPlaceholder = computed(() =>
    normalizedAutoTotalCells.value || monitorEstimatedTotalCells.value || t(globalFields[0].placeholderKey)
  );
  const totalAveragePlaceholder = computed(() => globalPlaceholders.totalAverage || t(globalFields[1].placeholderKey));
  const monitorOutlineDetail = computed(() => selectedMonitorOutline.value
    ? buildMonitorOutlineDetail(selectedMonitorOutline.value)
    : null);
  const monitorCellClassMap = computed(() => {
    const map = new Map();
    for (const outline of monitorGridState.value.outlines) {
      for (const cell of outline.cells) {
        map.set(cell, [
          'is-revealed',
          cell === outline.boxId ? 'is-origin' : '',
        ].filter(Boolean));
      }
    }
    return map;
  });

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function loadSavedState() {
    try {
      return safeParse(window.localStorage.getItem(profile.storageKey));
    } catch (_error) {
      return null;
    }
  }

  function createEmptySummary() {
    return {
      total: null,
      low: null,
      high: null,
    };
  }

  function hasLegacyComputedArtifacts(saved) {
    if (saved?.lastState) return true;
    if (Array.isArray(saved?.rows) && saved.rows.length > 0) return true;
    return ['total', 'low', 'high'].some((key) => saved?.summary?.[key] !== null && saved?.summary?.[key] !== undefined);
  }

  function hasMonitorDerivedSavedState(saved) {
    if (saved?.hasMonitorDerivedInputs !== undefined) {
      return Boolean(saved.hasMonitorDerivedInputs);
    }
    return !saved?.hasCalculated && hasLegacyComputedArtifacts(saved);
  }

  function hasRestorableValidationError() {
    return metaStatus.value === 'status-error' && metaErrorKind.value === 'validation-error-explicit';
  }

  function getExplicitOnlyGlobalInputs(source = globalInputs) {
    return {
      totalCells: String(source?.totalCells ?? '').trim(),
      totalAverage: String(source?.totalAverage ?? '').trim(),
    };
  }

  function getExplicitOnlyGroupInputs(source = groupInputs) {
    return Object.fromEntries(groups.map((group) => [
      group.key,
      {
        avg: String(source?.[group.key]?.avg ?? '').trim(),
        cells: String(source?.[group.key]?.cells ?? '').trim(),
        priceAverage: String(source?.[group.key]?.priceAverage ?? '').trim(),
        totalPrice: String(source?.[group.key]?.totalPrice ?? '').trim(),
      },
    ]));
  }

  function isValidationErrorReproducibleFromExplicitInputs(errorMessage, savedInputs = null) {
    try {
      const explicitGlobalInputs = getExplicitOnlyGlobalInputs(savedInputs?.global ?? globalInputs);
      const explicitGroupInputs = getExplicitOnlyGroupInputs(savedInputs?.groups ?? groupInputs);
      applyExplicitGroupTotalPriceOverrides(
        attachExplicitGroupTotalPriceInputs(
          collectEstimationInputs(explicitGlobalInputs, explicitGroupInputs, groups),
          explicitGroupInputs,
        ),
      );
      return false;
    } catch (explicitError) {
      return getErrorMessage(explicitError) === errorMessage;
    }
  }

  function hasSavedRestorableValidationError(saved) {
    if (saved?.meta?.status !== 'status-error') return false;
    const errorKind = String(saved?.meta?.errorKind ?? '');
    if (errorKind === 'validation-error-explicit') return true;
    if (errorKind && errorKind !== 'validation-error') return false;
    return isValidationErrorReproducibleFromExplicitInputs(
      String(saved?.meta?.text ?? ''),
      saved?.inputs ?? null,
    );
  }

  function isExplicitOnlyValidationError(error) {
    return isValidationErrorReproducibleFromExplicitInputs(getErrorMessage(error));
  }

  function classifyValidationErrorKind(error) {
    return isExplicitOnlyValidationError(error)
      ? 'validation-error-explicit'
      : 'validation-error-monitor-derived';
  }

  function canPersistCalculatedResults() {
    return hasCalculated.value && !hasMonitorPlaceholderInputs();
  }

  function saveState() {
    if (isRestoring.value || isDiscardingPageState) return;

    const hasMonitorDerivedInputs = hasMonitorPlaceholderInputs();
    const canRestoreCalculatedResults = canPersistCalculatedResults();
    const canRestoreMeta = !hasMonitorDerivedInputs || hasRestorableValidationError();

    try {
      window.localStorage.setItem(profile.storageKey, JSON.stringify({
        inputs: {
          global: { ...globalInputs },
          groups: Object.fromEntries(groups.map((group) => [
            group.key,
            { ...groupInputs[group.key] },
          ])),
        },
        hasCalculated: canRestoreCalculatedResults,
        hasMonitorDerivedInputs,
        lastState: canRestoreCalculatedResults ? lastState.value : null,
        rows: canRestoreCalculatedResults ? tableRows.value : [],
        summary: canRestoreCalculatedResults ? { ...summary } : createEmptySummary(),
        meta: canRestoreMeta
          ? {
            text: metaText.value,
            status: metaStatus.value,
            errorKind: metaStatus.value === 'status-error' ? metaErrorKind.value : '',
          }
          : null,
        monitorAuto: {
          gameUid: activeMonitorGameUid,
        },
        savedAt: new Date().toISOString(),
      }));
    } catch (_error) {
      // Page state is a convenience feature; storage failures should not block the UI.
    }
  }

  function clearSavedState() {
    try {
      window.localStorage.removeItem(profile.storageKey);
    } catch (_error) {
      // Storage cleanup is best-effort only.
    }
  }

  function applyControls(controls) {
    if (!controls || typeof controls !== 'object') return;

    globalInputs.totalCells = controls['total-cells-all']?.value ?? '';
    globalInputs.totalAverage = controls['avg-all']?.value ?? '';

    for (const group of groups) {
      groupInputs[group.key].avg = controls[`avg-${group.key}`]?.value ?? '';
      groupInputs[group.key].cells = controls[`cells-${group.key}`]?.value ?? '';
      groupInputs[group.key].priceAverage = controls[`price-${group.key}`]?.value ?? '';
      groupInputs[group.key].totalPrice = controls[`total-price-${group.key}`]?.value ?? '';
    }
  }

  function restoreState() {
    const saved = loadSavedState();
    if (!saved) return false;

    isRestoring.value = true;
    try {
      if (saved.inputs) {
        Object.assign(globalInputs, saved.inputs.global ?? {});
        for (const group of groups) {
          Object.assign(groupInputs[group.key], saved.inputs.groups?.[group.key] ?? {});
        }
        activeMonitorGameUid = saved.monitorAuto?.gameUid ? String(saved.monitorAuto.gameUid) : null;
      } else if (saved.controls) {
        applyControls(saved.controls);
      }

      const canRestoreCalculatedResults = Boolean(saved.hasCalculated);
      const canRestoreMeta = Boolean(saved.meta)
        && (!hasMonitorDerivedSavedState(saved) || hasSavedRestorableValidationError(saved));
      hasCalculated.value = canRestoreCalculatedResults;
      lastState.value = canRestoreCalculatedResults ? (saved.lastState ?? null) : null;
      tableRows.value = canRestoreCalculatedResults && Array.isArray(saved.rows) ? saved.rows : [];
      Object.assign(summary, canRestoreCalculatedResults ? (saved.summary ?? createEmptySummary()) : createEmptySummary());
      metaText.value = canRestoreMeta ? (saved.meta?.text ?? t(heroKey('meta.waitingInput'))) : t(heroKey('meta.waitingInput'));
      metaStatus.value = canRestoreMeta ? (saved.meta?.status ?? '') : '';
      if (canRestoreMeta && saved.meta?.status === 'status-error') {
        const savedErrorKind = String(saved.meta?.errorKind ?? '');
        const restoreAsExplicitValidationError = hasSavedRestorableValidationError(saved)
          && (!savedErrorKind || savedErrorKind === 'validation-error');
        metaErrorKind.value = restoreAsExplicitValidationError
          ? 'validation-error-explicit'
          : savedErrorKind;
      } else {
        metaErrorKind.value = '';
      }
    } finally {
      isRestoring.value = false;
    }

    return true;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return '-';
    return Math.round(value).toLocaleString('zh-CN');
  }

  function formatAverage(value) {
    return value === null || !Number.isFinite(value) ? '-' : value.toFixed(2);
  }

  function formatMonitorOutlineValue(outline) {
    const value = getMonitorOutlineValue(outline);
    return value === null ? '' : formatMoney(value);
  }

  function getMonitorOutlineValue(outline) {
    if (outline.price !== null && outline.price !== undefined) return outline.price;
    const detail = buildMonitorOutlineDetail(outline);
    if (!detail?.stats) return null;
    return getGroupKeyForQuality(outline.qualityName, outline.qualityId) === 'red'
      ? detail.stats.min
      : detail.stats.median;
  }

  function getMonitorOutlineGroupSummaries() {
    const summaries = {};
    const seen = new Set();
    for (const outline of monitorGridState.value.outlines) {
      if (outline.qualityStatus !== 'confirmed') continue;
      const groupKey = getGroupKeyForQuality(outline.qualityName, outline.qualityId);
      if (!groupKey) continue;
      const footprintKey = `${outline.boxId}:${outline.label}`;
      if (seen.has(footprintKey)) continue;
      seen.add(footprintKey);

      summaries[groupKey] ??= {
        outlineCells: 0,
        outlineValue: 0,
        exactCells: 0,
        exactValue: 0,
        count: 0,
        hasMissingValue: false,
      };
      const summaryEntry = summaries[groupKey];
      summaryEntry.count += 1;

      if (outline.price !== null && outline.price !== undefined) {
        summaryEntry.exactCells += outline.cells.length;
        summaryEntry.exactValue += outline.price;
      } else {
        const value = getMonitorOutlineValue(outline);
        if (value === null) {
          summaryEntry.hasMissingValue = true;
        } else {
          summaryEntry.outlineCells += outline.cells.length;
          summaryEntry.outlineValue += value;
        }
      }
    }
    return summaries;
  }

  function applyMonitorOutlineValueOverrides(state) {
    const summaries = getMonitorOutlineGroupSummaries();
    const stateGroups = Object.fromEntries(groups.map((group) => [
      group.key,
      { ...state.groups[group.key] },
    ]));
    let hasOverride = false;

    for (const group of groups) {
      const outlineSummary = summaries[group.key];
      const input = stateGroups[group.key];
      const knownCells = outlineSummary ? outlineSummary.outlineCells + outlineSummary.exactCells : 0;

      if (
        outlineSummary &&
        input.cells !== null &&
        knownCells > 0 &&
        knownCells <= input.cells
      ) {
        const remainingCells = input.cells - knownCells;
        const valueOverride = remainingCells * (profile.perCellExpected[group.key] ?? 0)
          + outlineSummary.outlineValue
          + outlineSummary.exactValue;
        stateGroups[group.key] = {
          ...input,
          count: input.count ?? outlineSummary.count,
          valueOverride,
          valueSource: 'monitorOutlines',
        };
        hasOverride = true;
        continue;
      }

      if (outlineSummary && input.cells === null) {
        const outlineCells = outlineSummary.exactCells + outlineSummary.outlineCells;
        const outlineValue = outlineSummary.exactValue + outlineSummary.outlineValue;
        if (outlineCells > 0) {
          stateGroups[group.key] = {
            ...input,
            monitorKnownCells: outlineCells,
            monitorKnownValue: outlineValue,
          };
          hasOverride = true;
        }
      }
    }

    return hasOverride ? { ...state, groups: stateGroups } : state;
  }

  function openMonitorOutlineDetail(outline) {
    selectedMonitorOutline.value = outline;
  }

  function closeMonitorOutlineDetail() {
    selectedMonitorOutline.value = null;
  }

  function buildMonitorOutlineDetail(outline) {
    if (!outline) return null;
    if (outline.price !== null && outline.price !== undefined) {
      return {
        outline,
        candidates: [],
        exactPrice: outline.price,
        stats: null,
      };
    }
    const candidates = getMonitorOutlineCandidates(outline);
    const stats = getPriceStats(candidates);
    return {
      outline,
      candidates,
      stats,
    };
  }

  function getMonitorOutlineCandidates(outline) {
    if (!outline?.qualityName || outline.qualityStatus === 'conflict') return [];
    const quality = normalizeOutlineQuality(outline.qualityName);
    if (!quality) return [];
    return collectibleItems.value
      .filter((item) =>
        item?.quality === quality &&
        item?.size?.key === outline.label &&
        Number.isFinite(Number(item.price))
      )
      .map((item) => ({ ...item, price: Number(item.price) }))
      .sort((left, right) => left.price - right.price || left.name.localeCompare(right.name, 'zh-CN'));
  }

  function normalizeOutlineQuality(qualityName) {
    const value = String(qualityName ?? '').trim();
    if (value === '橙') return '金';
    return ['白', '绿', '蓝', '紫', '金', '红'].includes(value) ? value : '';
  }

  function getGroupKeyForQuality(qualityName, qualityId = undefined) {
    return resolveGroupKeyFromQuality(profile, qualityName, qualityId);
  }

  function getPriceStats(candidates) {
    if (!candidates.length) return null;
    const prices = candidates.map((item) => item.price).sort((left, right) => left - right);
    const total = prices.reduce((sum, price) => sum + price, 0);
    return {
      count: prices.length,
      min: prices[0],
      max: prices[prices.length - 1],
      mean: total / prices.length,
      median: getMedian(prices),
      p25: getPercentile(prices, 0.25),
      p75: getPercentile(prices, 0.75),
    };
  }

  function getMedian(sortedValues) {
    const middle = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2
      ? sortedValues[middle]
      : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  function getPercentile(sortedValues, percentile) {
    if (sortedValues.length === 1) return sortedValues[0];
    const position = (sortedValues.length - 1) * percentile;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sortedValues[lower];
    const weight = position - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function getMonitorOutlineQualityClass(outline) {
    if (outline.qualityStatus === 'conflict') return 'quality-conflict';
    const qualityId = Number(outline?.qualityId);
    const qualityIdClassMap = {
      1: 'quality-white',
      2: 'quality-green',
      3: 'quality-blue',
      4: 'quality-purple',
      5: 'quality-gold',
      6: 'quality-red',
    };
    if (Number.isInteger(qualityId) && qualityIdClassMap[qualityId]) {
      return qualityIdClassMap[qualityId];
    }
    const groupKey = getGroupKeyForQuality(outline?.qualityName, outline?.qualityId);
    const qualityGroupClassMap = {
      white: 'quality-white',
      green: 'quality-green',
      wg: 'quality-white',
      blue: 'quality-blue',
      purple: 'quality-purple',
      orange: 'quality-gold',
      red: 'quality-red',
    };
    if (groupKey && qualityGroupClassMap[groupKey]) {
      return qualityGroupClassMap[groupKey];
    }
    const quality = String(outline.qualityName ?? '').trim();
    const classMap = {
      白: 'quality-white',
      绿: 'quality-green',
      蓝: 'quality-blue',
      紫: 'quality-purple',
      金: 'quality-gold',
      橙: 'quality-gold',
      红: 'quality-red',
    };
    return classMap[quality] ?? 'quality-unknown';
  }

  function getBoxQualityGroupKey(box) {
    return getGroupKeyForQuality(
      box?.itemQuilityName ?? box?.itemQualityName ?? box?.quality,
      box?.itemQuility ?? box?.itemQuality ?? box?.qualityId,
    );
  }

  function getMonitorOutlineAggregateFill(skill, event = null) {
    if (event?.group !== 'map') return null;
    const hitBoxList = Array.isArray(skill?.hitBoxList) ? skill.hitBoxList : [];
    if (!hitBoxList.length) return null;

    const byFootprint = new Map();
    for (const box of hitBoxList) {
      if (box?.itemCid !== undefined || box?.itemName || box?.itemPrice !== undefined || box?.price !== undefined) {
        return null;
      }
      const size = parseSlotType(box?.itemSlotType);
      const groupKey = getBoxQualityGroupKey(box);
      if (!size || !groupKey) return null;
      byFootprint.set(`${box?.boxId}:${size.label}`, {
        groupKey,
        cells: size.cells,
      });
    }

    const entries = [...byFootprint.values()];
    const groupKeys = new Set(entries.map((entry) => entry.groupKey));
    if (groupKeys.size !== 1) return null;

    return {
      groupKey: entries[0].groupKey,
      fieldKey: 'cells',
      value: formatMonitorInputNumber(entries.reduce((sum, entry) => sum + entry.cells, 0)),
    };
  }

  function getMonitorGlobalAverageFill(skill, event = null) {
    if (event?.group !== 'map') return null;
    if (Number(skill?.skillCid) !== 200014) return null;
    const value = formatMonitorInputNumber(skill?.allHitItemAvgBoxIndex);
    return value ? { fieldKey: 'totalAverage', value } : null;
  }

  function applyAutoGlobalInput(fill) {
    if (!fill) return false;
    if (globalPlaceholders[fill.fieldKey] === undefined) return false;
    if (globalPlaceholders[fill.fieldKey] === fill.value) return false;
    globalPlaceholders[fill.fieldKey] = fill.value;
    refreshTotalCellOptions(true);
    return true;
  }

  function applyAutoGroupInput(fill) {
    if (!fill) return false;
    if (groupPlaceholders[fill.groupKey]?.[fill.fieldKey] === undefined) return false;
    if (groupPlaceholders[fill.groupKey][fill.fieldKey] === fill.value) return false;
    groupPlaceholders[fill.groupKey][fill.fieldKey] = fill.value;
    return true;
  }

  function formatMonitorInputNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (Number.isInteger(number)) return String(number);
    return String(Number(number.toFixed(4)));
  }

  function handleMonitorGameChange(gameUid) {
    const nextGameUid = String(gameUid ?? '').trim();
    if (!nextGameUid || nextGameUid === activeMonitorGameUid) return;
    if (activeMonitorGameUid === null) {
      activeMonitorGameUid = nextGameUid;
      saveState();
      return;
    }
    clearHeroEstimatorInputsAndResults({ nextGameUid });
    saveState();
  }

  function clearHeroEstimatorInputsAndResults({ nextGameUid = null } = {}) {
    cancelActiveCalculations();
    globalInputs.totalCells = '';
    globalInputs.totalAverage = '';
    globalPlaceholders.totalAverage = '';
    totalCellOptions.value = [];
    totalAverageOptionSource.value = '';
    for (const group of groups) {
      groupInputs[group.key].avg = '';
      groupInputs[group.key].cells = '';
      groupInputs[group.key].priceAverage = '';
      groupInputs[group.key].totalPrice = '';
      groupPlaceholders[group.key].avg = '';
      groupPlaceholders[group.key].cells = '';
      groupPlaceholders[group.key].priceAverage = '';
      groupPlaceholders[group.key].totalPrice = '';
    }
    monitorGridState.value = monitorAdapter.createState();
    activeMonitorGameUid = nextGameUid ? String(nextGameUid) : null;
    activeMonitorProfileId = profile.id === 'ethan' ? 'ethan' : null;
    appliedMonitorEventKeys.clear();
    selectedMonitorOutline.value = null;
    hasCalculated.value = false;
    lastState.value = null;
    setEmpty(t(heroKey('meta.waitingInput')));
  }

  function getEffectiveGroupInputs() {
    return Object.fromEntries(groups.map((group) => [
      group.key,
      {
        avg: String(groupInputs[group.key].avg).trim() || groupPlaceholders[group.key].avg,
        cells: String(groupInputs[group.key].cells).trim() || groupPlaceholders[group.key].cells,
        priceAverage: String(groupInputs[group.key].priceAverage).trim() || groupPlaceholders[group.key].priceAverage,
        totalPrice: String(groupInputs[group.key].totalPrice).trim() || groupPlaceholders[group.key].totalPrice,
      },
    ]));
  }

  function supportsGroupTotalPrice(groupKey) {
    return (profile.totalPriceGroupKeys ?? []).includes(groupKey);
  }

  function hasMonitorPlaceholderInputs() {
    const usesMonitorTotalCells = !String(globalInputs.totalCells).trim() && monitorEstimatedTotalCells.value;
    const usesMonitorTotalAverage = !String(globalInputs.totalAverage).trim() && globalPlaceholders.totalAverage;
    return Boolean(usesMonitorTotalCells || usesMonitorTotalAverage || groups.some((group) =>
      ['avg', 'cells', 'priceAverage'].some(
        (field) => !String(groupInputs[group.key][field]).trim() && groupPlaceholders[group.key][field],
      ),
    ));
  }

  function getEffectiveGlobalInputs() {
    return {
      ...globalInputs,
      totalCells: String(globalInputs.totalCells).trim()
        || normalizedAutoTotalCells.value
        || monitorEstimatedTotalCells.value,
      totalAverage: String(globalInputs.totalAverage).trim() || globalPlaceholders.totalAverage,
    };
  }

  function attachExplicitGroupTotalPriceInputs(state, effectiveGroupInputs) {
    const stateGroups = Object.fromEntries(groups.map((group) => [
      group.key,
      { ...state.groups[group.key] },
    ]));

    for (const group of groups) {
      const totalPrice = supportsGroupTotalPrice(group.key)
        ? parseOptionalNumber(
          effectiveGroupInputs[group.key]?.totalPrice,
          `${t(group.labelKey)} ${t(heroKey('fields.totalPrice'))}`.trim(),
        )
        : null;
      stateGroups[group.key] = {
        ...stateGroups[group.key],
        totalPrice,
      };
    }

    return {
      ...state,
      groups: stateGroups,
    };
  }

  function applyExplicitGroupTotalPriceOverrides(state) {
    const stateGroups = Object.fromEntries(groups.map((group) => [
      group.key,
      { ...state.groups[group.key] },
    ]));

    for (const group of groups) {
      const input = stateGroups[group.key];
      if (!Number.isFinite(input.totalPrice) || input.totalPrice <= 0 || input.cells === null) continue;

      const exactCounts = findMatchingTotalPriceCounts(
        collectibleItemsByGroup.value[group.key] ?? [],
        input.cells,
        input.totalPrice,
      );
      if (exactCounts.length === 0) {
        throw new Error(t(heroKey('meta.totalPriceConstraintConflict'), { label: t(group.labelKey) }));
      }

      const exactCountsSet = new Set(exactCounts);
      let nextCount = input.count;
      if (nextCount !== null && !exactCountsSet.has(nextCount)) {
        throw new Error(t(heroKey('meta.totalPriceConstraintConflict'), { label: t(group.labelKey) }));
      }

      let allowedCounts = nextCount === null ? exactCounts : [nextCount];
      if (input.priceAverage !== null) {
        allowedCounts = allowedCounts.filter((count) => findTotalForAveragePrice(input.priceAverage, count) === input.totalPrice);
        if (allowedCounts.length === 0) {
          throw new Error(t(heroKey('meta.totalPriceAveragePriceConflict'), { label: t(group.labelKey) }));
        }
      }

      if (nextCount === null && allowedCounts.length === 1) {
        [nextCount] = allowedCounts;
      }

      stateGroups[group.key] = {
        ...input,
        count: nextCount,
        valueOverride: input.totalPrice,
        valueSource: 'totalPrice',
      };
    }

    return {
      ...state,
      groups: stateGroups,
    };
  }

  function refreshTotalCellOptions(force = false) {
    const source = String(globalInputs.totalAverage).trim() || globalPlaceholders.totalAverage;
    if (!force && source === totalAverageOptionSource.value) return;

    totalAverageOptionSource.value = source;
    totalCellOptions.value = [];
    if (!source) return;

    try {
      const average = parseOptionalNumber(source, t(heroKey('fields.totalAverage')));
      const options = getFeasibleCellsFromAverage(average);
      totalCellOptions.value = options;

      const currentTotalCells = String(globalInputs.totalCells).trim();
      if (currentTotalCells && !options.some((option) => String(option.cells) === currentTotalCells)) {
        globalInputs.totalCells = '';
      }
    } catch (_error) {
      totalCellOptions.value = [];
    }
  }

  function handleTotalAverageBlur() {
    refreshTotalCellOptions();
  }

  function setEmpty(text = t(heroKey('noResults')), status = '', errorKind = '') {
    tableRows.value = [];
    summary.total = null;
    summary.low = null;
    summary.high = null;
    metaText.value = text;
    metaStatus.value = status;
    metaErrorKind.value = status === 'status-error' ? errorKind : '';
  }

  function stopPriceSearch() {
    priceSearchRunId += 1;
    if (priceSearchSource) {
      priceSearchSource.close();
      priceSearchSource = null;
    }
  }

  function stopEstimationWorker() {
    estimationRunId += 1;
    if (activeEstimationWorker) {
      try {
        activeEstimationWorker.postMessage(toWorkerMessage({
          type: 'cancel',
          runId: estimationRunId - 1,
        }));
      } catch (_error) {
        // Best-effort only; the worker may already be gone.
      }
      activeEstimationWorker.terminate();
      activeEstimationWorker = null;
    }
  }

  function clearPendingEstimateRefresh() {
    if (pendingEstimateRefreshTimer !== null) {
      window.clearTimeout(pendingEstimateRefreshTimer);
      pendingEstimateRefreshTimer = null;
    }
  }

  function cancelActiveCalculations() {
    stopPriceSearch();
    stopEstimationWorker();
    clearPendingEstimateRefresh();
  }

  function renderResults(state, prediction, rows) {
    const unitPriceText = prediction.unitPrice ? t(heroKey('meta.unitPrice'), { price: formatMoney(prediction.unitPrice) }) : '';
    const totalCountText = state.totalCount === null ? '' : t(heroKey('meta.totalCount'), { count: state.totalCount });

    lastState.value = state;
    summary.total = prediction.total;
    summary.low = prediction.total;
    summary.high = prediction.total;
    metaText.value = t(heroKey('meta.resultSummary'), { message: prediction.message, remaining: prediction.remaining, unitPrice: unitPriceText, totalCount: totalCountText });
    metaStatus.value = '';
    tableRows.value = rows;
  }

  function getPredictionConfigs(groupKeys) {
    return groupKeys
      .map((groupKey) => predictionConfigs.find((config) => config.groupKey === groupKey))
      .filter(Boolean);
  }

  function setPredictionSummaryFromRow(row) {
    if (tableRows.value.length !== 0) return;
    summary.total = row.mean;
    summary.low = row.low;
    summary.high = row.high;
  }

  function renderWorkerStart(message) {
    if (message.mode === 'combined') {
      const configs = getPredictionConfigs(message.groupKeys);
      tableRows.value = [];
      summary.total = null;
      summary.low = null;
      summary.high = null;
      lastState.value = message.state;
      metaText.value = t(heroKey('meta.combinedAvgList'), {
        labels: configs.map((config) => t(config.labelKey)).join('、'),
        count: message.count,
      });
      metaStatus.value = '';
      return;
    }

    if (message.mode === 'single') {
      const config = predictionConfigs.find((item) => item.groupKey === message.groupKey);
      tableRows.value = [];
      summary.total = null;
      summary.low = null;
      summary.high = null;
      lastState.value = message.state;
      metaText.value = t(heroKey('meta.avgOnlyList'), {
        label: config ? t(config.labelKey) : message.groupKey,
        count: message.count,
      });
      metaStatus.value = '';
    }
  }

  function renderWorkerRow(message) {
    if (message.mode === 'combined') {
      const rowConfigs = getPredictionConfigs(message.groupKeys ?? Object.keys(message.item.candidatesByGroup ?? {}));
      const row = withAverageMatchTags(
        buildCombinedPredictionRow(tableRows.value.length + 1, message.item, rowConfigs, t, heroKey),
        message.matchedGroupKeys,
        rowConfigs,
        t,
        heroKey,
      );
      setPredictionSummaryFromRow(row);
      tableRows.value = [...tableRows.value, row];
      saveState();
      return;
    }

    if (message.mode === 'single') {
      const groupKey = message.groupKey ?? Object.keys(message.item.candidatesByGroup ?? {})[0];
      const config = predictionConfigs.find((item) => item.groupKey === groupKey);
      if (!config) return;
      const row = withAverageMatchTags(
        buildPredictionRow(tableRows.value.length + 1, message.item, config, t, heroKey),
        message.matchedGroupKeys,
        [config],
        t,
        heroKey,
      );
      setPredictionSummaryFromRow(row);
      tableRows.value = [...tableRows.value, row];
      saveState();
    }
  }

  function getGroupKeyForWorkerRow(row) {
    return groups.find((group) => group.labelKey === row.labelKey)?.key;
  }

  function renderWorkerResult(result) {
    if (result.type === 'empty' && result.reason === 'priceCellsNoMatch') {
      setEmpty(t(heroKey('meta.priceCellsNoMatch'), {
        label: t(result.missing.labelKey),
        cells: result.missing.cells,
      }), result.status);
      saveState();
      return;
    }

    if (result.type === 'direct') {
      renderResults(result.state, result.prediction, result.groupRows.map((row) => {
        const groupKey = getGroupKeyForWorkerRow(row);
        const priceErrorText = row.priceScore !== null
          ? t(heroKey('status.priceError'), { score: `${(row.priceScore * 100).toFixed(1)}%` })
          : (groupKey && result.state.groups[groupKey]?.priceAverage !== null
              ? t(heroKey('status.priceError'), { score: '-' })
              : '');
        return { ...row, groupKey, label: t(row.labelKey), status: t(row.statusKey) + priceErrorText };
      }));
      saveState();
    }
  }

  function applyPriceMatchUpdate(message) {
    const { groupKey, rowIndex, delta } = message;
    if (rowIndex === null) {
      const row = tableRows.value.find((r) => r.groupKey === groupKey);
      if (!row) return;
      row.mean += delta;
      row.low += delta;
      row.high += delta;
      summary.total += delta;
      summary.low += delta;
      summary.high += delta;
    } else {
      const row = tableRows.value[rowIndex];
      if (!row) return;
      row.mean += delta;
      row.low += delta;
      row.high += delta;
      if (rowIndex === 0) {
        summary.total += delta;
        summary.low += delta;
        summary.high += delta;
      }
    }
  }

  function getPredictionConfig(groupKey) {
    return predictionConfigs.find((item) => item.groupKey === groupKey);
  }

  function buildStreamRow(message) {
    const config = getPredictionConfig(message.groupKey ?? message.row?.groupKey);
    if (!config || !message.row) return null;
    const row = message.row;
    const totalCountText = row.totalCount === null ? '-' : row.totalCount;
    const base = {
      label: t(heroKey('status.plan'), { index: tableRows.value.length + 1 }),
      count: row.count,
      cells: row.cells,
      avg: row.avg,
      low: row.low,
      mean: row.mean,
      high: row.high,
      statusClass: row.isOverflow ? 'status-over' : 'status-ok',
      predictionGroupKey: config.groupKey,
      predictionCandidates: {
        [config.groupKey]: {
          count: row.count,
          cells: row.cells,
        },
      },
    };

    if (row.kind === 'total-price') {
      const tags = [t(heroKey('status.groupTotalPriceMatchTag'), { label: t(config.labelKey) })];
      if (row.hasPriceMatch) {
        tags.push(t(heroKey('status.groupPriceMatchTag'), { label: t(config.labelKey) }));
      }
      if (row.isOverflow) {
        tags.push(t(heroKey('status.overflowCells'), { total: row.overflowTotal }));
      }
      return {
        ...base,
        status: t(heroKey('status.planDetail'), {
          label: t(heroKey('status.groupPredictionLabel'), { label: t(config.labelKey) }),
          remaining: row.remaining,
          totalCount: totalCountText,
        }),
        tags: [...new Set(tags)],
      };
    }

    if (!row.companion) {
      const tags = [t(heroKey('status.priceMatchTag'))];
      if (row.isOverflow) {
        tags.push(t(heroKey('status.overflowCells'), { total: row.overflowTotal }));
      }
      return {
        ...base,
        status: t(heroKey('status.planDetail'), {
          label: t(heroKey('status.groupPriceMatchTag'), { label: t(config.labelKey) }),
          remaining: row.remaining,
          totalCount: totalCountText,
        }),
        tags,
      };
    }

    return {
      ...base,
      status: t(heroKey('status.priceWithAverageCompanionDetail'), {
        label: t(config.labelKey),
        companion: t(getPredictionConfig(row.companion.groupKey)?.labelKey ?? row.companion.groupKey),
        count: row.companion.count,
        minCount: row.companion.minCount,
        maxCount: row.companion.maxCount,
        minCells: row.companion.minCells,
        maxCells: row.companion.maxCells,
        minRemaining: row.companion.minRemaining,
        maxRemaining: row.companion.maxRemaining,
        totalCount: totalCountText,
      }),
      tags: [t(heroKey('status.groupPriceMatchTag'), { label: t(config.labelKey) })],
    };
  }

  function applyStreamRowSummary(row) {
    if (tableRows.value.length === 0) {
      summary.total = row.mean;
      summary.low = row.low;
      summary.high = row.high;
      return;
    }
    summary.low = summary.low === null ? row.low : Math.min(summary.low, row.low);
    summary.high = summary.high === null ? row.high : Math.max(summary.high, row.high);
  }

  function renderStreamRow(message) {
    const row = buildStreamRow(message);
    if (!row) return;
    applyStreamRowSummary(row);
    tableRows.value = [...tableRows.value, row];

    const config = getPredictionConfig(message.groupKey ?? row.predictionGroupKey);
    if (config) {
      metaText.value = message.streamMode === 'total-price'
        ? t(heroKey('meta.totalPriceFound'), { label: t(config.labelKey), count: tableRows.value.length })
        : t(heroKey('meta.priceFound'), { label: t(config.labelKey), count: tableRows.value.length });
      metaStatus.value = '';
    }
    saveState();

    if (tableRows.value.length >= PREDICTION_OUTPUT_LIMIT && priceSearchSource) {
      closePriceSearchAtLimit(priceSearchSource, message.runId, config);
    }
  }

  function renderStreamComplete(message) {
    const config = getPredictionConfig(message.groupKey);
    if (!config) return;

    if (message.count === 0) {
      if (message.streamMode === 'total-price') {
        const messageKey = message.emptyReason === 'average-price-conflict'
          ? 'meta.totalPriceAveragePriceConflict'
          : message.emptyReason === 'constraint-conflict'
            ? 'meta.totalPriceConstraintConflict'
            : 'meta.totalPriceNoResults';
        setEmpty(t(heroKey(messageKey), { label: t(config.labelKey) }), 'status-warn');
      } else {
        setEmpty(t(heroKey('meta.priceNoResults'), { label: t(config.labelKey) }), 'status-warn');
      }
      saveState();
      return;
    }

    if (message.streamMode === 'total-price') {
      metaText.value = message.reason === 'stopped'
        ? t(heroKey('meta.totalPriceSearchStopped'), { label: t(config.labelKey), count: message.count })
        : t(heroKey('meta.totalPriceSearchDone'), { label: t(config.labelKey), count: message.count });
      metaStatus.value = message.reason === 'stopped' ? 'status-warn' : '';
    } else {
      metaText.value = message.reason === 'stopped'
        ? t(heroKey('meta.priceSearchStopped'), { label: t(config.labelKey), count: message.count })
        : t(heroKey('meta.priceSearchDone'), { label: t(config.labelKey), count: message.count });
      metaStatus.value = message.reason === 'stopped' ? 'status-warn' : '';
    }
    saveState();
  }

  function applyEstimationError(message) {
    metaText.value = message;
    metaStatus.value = 'status-error';
    metaErrorKind.value = 'estimation-error';
    tableRows.value = [];
    summary.total = null;
    summary.low = null;
    summary.high = null;
    saveState();
  }

  function failActiveEstimationRun(runId, message) {
    if (runId !== estimationRunId) return;
    stopPriceSearch();
    stopEstimationWorker();
    applyEstimationError(message);
  }

  function handleEstimationWorkerMessage(runId, message) {
    if (runId !== estimationRunId || message.runId !== runId) return;
    if (message.type === 'start') {
      renderWorkerStart(message);
      return;
    }
    if (message.type === 'row') {
      renderWorkerRow(message);
      return;
    }
    if (message.type === 'stream-row') {
      renderStreamRow(message);
      return;
    }
    if (message.type === 'stream-complete') {
      renderStreamComplete(message);
      return;
    }
    if (message.type === 'result') {
      renderWorkerResult(message.result);
      return;
    }
    if (message.type === 'price-match-update') {
      applyPriceMatchUpdate(message);
      return;
    }
    if (message.type === 'price-match-done') {
      return;
    }
    if (message.type === 'done') {
      if (activeEstimationWorker) {
        activeEstimationWorker.terminate();
        activeEstimationWorker = null;
      }
      saveState();
      return;
    }
    if (message.type === 'error') {
      failActiveEstimationRun(runId, message.error);
    }
  }

  function startEstimationWorker(state) {
    const runId = estimationRunId + 1;
    const worker = ensureEstimationWorker(runId);
    if (!worker) return false;
    worker.postMessage(toWorkerMessage({
      type: 'start',
      runId,
      state,
      groups,
      profile,
      predictionGroupKeys: predictionConfigs.map((config) => config.groupKey),
      collectibleItemsByGroup: collectibleItemsByGroup.value,
      priceProfilesByGroup: priceProfilesByGroup.value,
      limit: PREDICTION_OUTPUT_LIMIT,
    }));
    return true;
  }

  function toWorkerMessage(message) {
    return JSON.parse(JSON.stringify(message));
  }

  function ensureEstimationWorker(runId = estimationRunId + 1) {
    if (typeof Worker !== 'function') return null;

    stopEstimationWorker();
    estimationRunId = runId;
    const worker = new Worker(new URL('../ethan/estimation-worker.js', import.meta.url), { type: 'module' });
    activeEstimationWorker = worker;
    worker.onmessage = (event) => handleEstimationWorkerMessage(runId, event.data);
    worker.onerror = (event) => {
      failActiveEstimationRun(runId, event?.message || String(event));
    };
    return worker;
  }

  function isPriceOnlyState(state, config) {
    const group = state.groups[config.groupKey];
    return group.avg === null &&
      group.cells === null &&
      group.priceAverage !== null;
  }

  function closePriceSearchAtLimit(source, runId, config) {
    if (priceSearchRunId !== runId || priceSearchSource !== source) return;
    source.close();
    priceSearchSource = null;
    activeEstimationWorker?.postMessage(toWorkerMessage({
      type: 'finish-stream-run',
      runId,
      reason: 'done',
    }));
    priceSearchRunId += 1;
  }

  function startTotalPriceSearch(state, config) {
    stopPriceSearch();
    const group = state.groups[config.groupKey];
    const totalPrice = group?.totalPrice;
    if (!Number.isFinite(totalPrice) || totalPrice <= 0 || group?.cells !== null) return false;

    if (typeof EventSource !== 'function') {
      setEmpty(t(heroKey('meta.noStreamSupport')), 'status-error', 'runtime-error');
      lastState.value = state;
      return true;
    }

    const runId = priceSearchRunId + 1;
    priceSearchRunId = runId;
    const worker = ensureEstimationWorker(runId);
    if (!worker) return false;

    lastState.value = state;
    tableRows.value = [];
    summary.total = null;
    summary.low = null;
    summary.high = null;
    metaText.value = t(heroKey('meta.totalPriceSearching'), { label: t(config.labelKey) });
    metaStatus.value = '';

    const params = new URLSearchParams({
      script: 'solve-gold-total.js',
      args: String(totalPrice),
      limit: String(PREDICTION_OUTPUT_LIMIT),
    });
    const source = new EventSource(`/run?${params.toString()}`);
    priceSearchSource = source;
    worker.postMessage(toWorkerMessage({
      type: 'start-stream-run',
      runId,
      streamMode: 'total-price',
      state,
      config,
      groups,
      profile,
      collectibleItemsByGroup: collectibleItemsByGroup.value,
      predictionConfigs,
      limit: PREDICTION_OUTPUT_LIMIT,
      minCellSpacing: PRICE_COMBO_MIN_CELL_SPACING,
    }));

    source.onmessage = (event) => {
      if (priceSearchRunId !== runId) return;
      const message = JSON.parse(event.data);
      if (message.type === 'out') {
        worker.postMessage(toWorkerMessage({
          type: 'append-source',
          runId,
          text: String(message.text ?? ''),
        }));
        return;
      }

      if (message.type === 'done') {
        source.close();
        if (priceSearchSource === source) priceSearchSource = null;
        worker.postMessage(toWorkerMessage({
          type: 'finish-stream-run',
          runId,
          reason: 'done',
        }));
      }
    };

    source.onerror = () => {
      source.close();
      if (priceSearchSource === source) priceSearchSource = null;
      if (priceSearchRunId !== runId) return;
      worker.postMessage(toWorkerMessage({
        type: 'finish-stream-run',
        runId,
        reason: 'stopped',
      }));
    };

    return true;
  }

  function startPriceOnlySearch(state, config) {
    stopPriceSearch();
    const effectiveMax = getEffectiveMaxCells(state, profile) ?? state.totalCells;
    const maxGroupCells = effectiveMax === null ? Infinity : effectiveMax - state.knownCells;
    if (maxGroupCells <= 0) {
      setEmpty(t(heroKey('meta.priceNoRemainingCells'), { label: t(config.labelKey) }), 'status-warn');
      lastState.value = state;
      return true;
    }
    if (typeof EventSource !== 'function') {
      setEmpty(t(heroKey('meta.noStreamSupport')), 'status-error', 'runtime-error');
      lastState.value = state;
      return true;
    }

    const runId = priceSearchRunId + 1;
    priceSearchRunId = runId;
    const worker = ensureEstimationWorker(runId);
    if (!worker) return false;
    lastState.value = state;
    tableRows.value = [];
    summary.total = null;
    summary.low = null;
    summary.high = null;
    metaText.value = t(heroKey('meta.priceSearching'), { label: t(config.labelKey) });
    metaStatus.value = '';

    const params = new URLSearchParams({
      script: config.script,
      args: `${state.groups[config.groupKey].priceAverage} dedupe-total-cells`,
      limit: String(PREDICTION_OUTPUT_LIMIT),
    });
    const source = new EventSource(`/run?${params.toString()}`);
    priceSearchSource = source;
    worker.postMessage(toWorkerMessage({
      type: 'start-stream-run',
      runId,
      streamMode: 'price-only',
      state,
      config,
      groups,
      profile,
      collectibleItemsByGroup: collectibleItemsByGroup.value,
      predictionConfigs,
      limit: PREDICTION_OUTPUT_LIMIT,
      minCellSpacing: PRICE_COMBO_MIN_CELL_SPACING,
    }));

    source.onmessage = (event) => {
      if (priceSearchRunId !== runId) return;
      const message = JSON.parse(event.data);
      if (message.type === 'out') {
        if (tableRows.value.length >= PREDICTION_OUTPUT_LIMIT) {
          closePriceSearchAtLimit(source, runId, config);
          return;
        }
        worker.postMessage(toWorkerMessage({
          type: 'append-source',
          runId,
          text: String(message.text ?? ''),
        }));
        return;
      }

      if (message.type === 'done') {
        source.close();
        if (priceSearchSource === source) priceSearchSource = null;
        worker.postMessage(toWorkerMessage({
          type: 'finish-stream-run',
          runId,
          reason: 'done',
        }));
      }
    };

    source.onerror = () => {
      source.close();
      if (priceSearchSource === source) priceSearchSource = null;
      if (priceSearchRunId !== runId) return;
      worker.postMessage(toWorkerMessage({
        type: 'finish-stream-run',
        runId,
        reason: 'stopped',
      }));
    };

    return true;
  }

  function runEstimationSync(baseState) {
    const needsAverageCellPrediction = predictionConfigs.some((config) => {
      const group = baseState.groups[config.groupKey];
      return group?.avg !== null && group.cells === null;
    });
    const predictionGroupKeySet = new Set(predictionConfigs.map((c) => c.groupKey));
    const needsAveragePriceCombination = groups.some((group) => {
      if (predictionGroupKeySet.has(group.key)) return false;
      const input = baseState.groups[group.key];
      return input?.cells !== null
        && input.priceAverage !== null
        && input.count === null
        && !Number.isFinite(input.valueOverride);
    });
    if (needsAverageCellPrediction || needsAveragePriceCombination) {
      // Prediction enumeration and exact average-price matching can be expensive;
      // without a worker, fail fast instead of blocking monitor/input updates.
      setEmpty(t(heroKey('meta.noEstimationWorkerSupport')), 'status-error', 'runtime-error');
      lastState.value = baseState;
      return;
    }

    const state = baseState;
    const prediction = estimateTotalByStage(state, groups, profile);
    renderResults(state, prediction, groups.map((group) => {
      const row = estimateGroupValue(group, state, priceProfilesByGroup.value, profile);
      const priceErrorText = row.priceScore !== null
        ? t(heroKey('status.priceError'), { score: `${(row.priceScore * 100).toFixed(1)}%` })
        : (state.groups[group.key]?.priceAverage !== null ? t(heroKey('status.priceError'), { score: '-' }) : '');
      return { ...row, label: t(row.labelKey), status: t(row.statusKey) + priceErrorText };
    }));
  }

  function runEstimation(state) {
    hasCalculated.value = true;
    cancelActiveCalculations();

    for (const config of predictionConfigs) {
      if (startTotalPriceSearch(state, config)) {
        return;
      }
    }

    for (const config of predictionConfigs) {
      if (isPriceOnlyState(state, config)) {
        // When an earlier prediction group also lacks cells, skip the
        // price-only stream — its companion logic would combine groups.
        // Let the flow fall through to the worker/sync path where the
        // earlier group's individual predictions will be shown.
        const configIndex = predictionConfigs.indexOf(config);
        const hasEarlierGroupMissingCells = predictionConfigs
          .slice(0, configIndex)
          .some(c => state.groups[c.groupKey]?.cells === null);
        if (!hasEarlierGroupMissingCells && startPriceOnlySearch(state, config)) {
          return;
        }
      }
    }

    if (startEstimationWorker(state)) return;
    runEstimationSync(state);
  }

  function handleSubmit() {
    window.bidkingDesktop?.resetInjectionTimer?.();

    try {
      if (!averagePricesByQuality.value) {
        metaText.value = t(heroKey('meta.dataLoadingRetry'));
        metaStatus.value = 'status-warn';
        return;
      }

      const effectiveGroupInputs = getEffectiveGroupInputs();
      const state = applyExplicitGroupTotalPriceOverrides(
        applyMonitorOutlineValueOverrides(
          attachExplicitGroupTotalPriceInputs(
            collectEstimationInputs(getEffectiveGlobalInputs(), effectiveGroupInputs, groups),
            effectiveGroupInputs,
          ),
        ),
      );
      runEstimation(state);
      saveState();
    } catch (error) {
      metaText.value = error.message;
      metaStatus.value = 'status-error';
      metaErrorKind.value = classifyValidationErrorKind(error);
      tableRows.value = [];
      summary.total = null;
      summary.low = null;
      summary.high = null;
      saveState();
    }
  }

  function handleClear() {
    pausedMonitorGameUid = activeMonitorGameUid;
    clearedMonitorEventKeys = new Set(appliedMonitorEventKeys);
    clearHeroEstimatorInputsAndResults();
    saveState();
  }

  function resetPanelState() {
    isDiscardingPageState = true;
    pausedMonitorGameUid = null;
    clearedMonitorEventKeys = new Set();
    clearHeroEstimatorInputsAndResults();
    clearSavedState();
  }

  async function loadData(loadingMessage = t(heroKey('meta.dataLoading'))) {
    isLoading.value = true;
    const preserveRestoredValidationError = !hasCalculated.value && hasRestorableValidationError();
    if (!preserveRestoredValidationError) {
      metaText.value = loadingMessage;
      metaStatus.value = '';
    }

    try {
      const [averageResponse, collectiblesResponse] = await Promise.all([
        fetch('/data/quality-size-average-prices.json', { cache: 'no-store' }),
        fetch('/data/collectibles.json', { cache: 'no-store' }),
      ]);
      if (!averageResponse.ok) throw new Error(`average prices HTTP ${averageResponse.status}`);
      if (!collectiblesResponse.ok) throw new Error(`collectibles HTTP ${collectiblesResponse.status}`);

      const [averagePrices, collectibles] = await Promise.all([
        averageResponse.json(),
        collectiblesResponse.json(),
      ]);
      averagePricesByQuality.value = averagePrices;
      collectibleItems.value = Array.isArray(collectibles) ? collectibles : [];
      priceProfilesByGroup.value = buildPriceProfilesByGroup(averagePricesByQuality.value, groups);
      collectibleItemsByGroup.value = Object.fromEntries(groups.map((group) => [
        group.key,
        prepareCollectibleItemsForGroup(collectibles, group.key, groups),
      ]));
      isLoading.value = false;
      if (!preserveRestoredValidationError) {
        metaText.value = t(heroKey('meta.dataLoaded'));
        metaStatus.value = '';
      }

      if (hasCalculated.value) {
        handleSubmit();
      }
    } catch (error) {
      isLoading.value = false;
      metaText.value = t(heroKey('meta.dataLoadFailed'), { error: error.message });
      metaStatus.value = 'status-error';
      metaErrorKind.value = 'load-error';
    }
  }

  function handlePageHide() {
    saveState();
  }

  function handleLeaveToolsPage() {
    resetPanelState();
  }

  function refreshEstimateAfterMonitorUpdate() {
    if ((hasCalculated.value || profile.id === 'elsa') && averagePricesByQuality.value) {
      clearPendingEstimateRefresh();
      pendingEstimateRefreshTimer = window.setTimeout(() => {
        pendingEstimateRefreshTimer = null;
        if ((hasCalculated.value || profile.id === 'elsa') && averagePricesByQuality.value) {
          handleSubmit();
        }
      }, 0);
    }
  }

  function getErrorMessage(error) {
    return error?.message || String(error);
  }

  function getCompatibleMonitorState(payload, rawProfileId = null) {
    const state = payload?.state;
    if (!state) return null;
    if (rawProfileId && state.profileId && state.profileId !== rawProfileId) return null;
    if (state.profileId === profile.id) return state;
    if (!state.profileId && profile.id === 'ethan' && (!rawProfileId || rawProfileId === 'ethan')) return state;
    return null;
  }

  function inferMonitorProfileIdFromRawEvent(rawPayload) {
    return inferProfileIdFromRawMonitorEvent(rawPayload);
  }

  function isCompatibleMonitorPayload(payloadGameUid, compatibleState, rawProfileId, rawPayload) {
    if (rawPayload?.group === 'hero' && !rawProfileId) return false;
    if (rawProfileId && rawProfileId !== profile.id) return false;
    if (compatibleState) return true;
    if (rawProfileId) return true;
    if (payloadGameUid && activeMonitorGameUid && payloadGameUid !== activeMonitorGameUid) {
      return profile.id === 'ethan';
    }
    if (activeMonitorProfileId) return activeMonitorProfileId === profile.id;
    return profile.id === 'ethan';
  }

  function handleMonitorPayload(payload) {
    if (!payload) return;

    let shouldRefreshEstimate = false;
    const payloadGameUid = String(payload.gameUid ?? payload.rawEvent?.gameUid ?? '').trim();
    const rawPayload = payload.rawEvent ?? payload;
    const rawProfileId = inferMonitorProfileIdFromRawEvent(rawPayload);
    const compatibleState = getCompatibleMonitorState(payload, rawProfileId);
    if (!isCompatibleMonitorPayload(payloadGameUid, compatibleState, rawProfileId, rawPayload)) return;
    const monitorEventKey = getMonitorPayloadEventKey(payloadGameUid, payload);
    if (pausedMonitorGameUid && payloadGameUid === pausedMonitorGameUid) return;
    cancelActiveCalculations();
    handleMonitorGameChange(payloadGameUid);
    if (pausedMonitorGameUid && payloadGameUid) {
      pausedMonitorGameUid = null;
      clearedMonitorEventKeys = new Set();
    }
    if (compatibleState?.profileId) {
      activeMonitorProfileId = compatibleState.profileId;
    } else if (rawProfileId) {
      activeMonitorProfileId = rawProfileId;
    }
    const nextMonitorState = compatibleState ?? monitorAdapter.applyPayload(monitorGridState.value, payload);
    if (nextMonitorState !== monitorGridState.value) {
      monitorGridState.value = nextMonitorState;
      shouldRefreshEstimate = true;
    }
    shouldRefreshEstimate = applyAutoGlobalInput(getMonitorGlobalAverageFill(rawPayload.skill, rawPayload)) || shouldRefreshEstimate;
    shouldRefreshEstimate = applyAutoGroupInput(getMonitorOutlineAggregateFill(rawPayload.skill, rawPayload)) || shouldRefreshEstimate;
    for (const fill of monitorAdapter.getAutoFills(nextMonitorState)) {
      shouldRefreshEstimate = applyAutoGroupInput(fill) || shouldRefreshEstimate;
    }
    if (monitorEventKey) appliedMonitorEventKeys.add(monitorEventKey);
    if (shouldRefreshEstimate) refreshEstimateAfterMonitorUpdate();
  }

  function getMonitorPayloadEventKey(gameUid, payload) {
    const rawPayload = payload?.rawEvent ?? payload;
    const key = String(payload?.key ?? rawPayload?.key ?? rawPayload?.skill?.uid ?? '').trim();
    if (!key) return '';
    return gameUid ? `${gameUid}:${key}` : key;
  }

  function refreshLocalizedOutput() {
    if (hasCalculated.value && averagePricesByQuality.value) {
      handleSubmit();
      return;
    }

    if (isLoading.value) {
      metaText.value = t(heroKey('meta.dataLoading'));
      return;
    }

    if (averagePricesByQuality.value && !metaStatus.value) {
      metaText.value = t(heroKey('meta.dataLoaded'));
      return;
    }

    if (!hasCalculated.value && !metaStatus.value) {
      metaText.value = t(heroKey('meta.waitingInput'));
    }
  }

  watch(
    [globalInputs, groupInputs],
    () => {
      saveState();
    },
    { deep: true },
  );

  watch(locale, refreshLocalizedOutput);

  onMounted(() => {
    restoreState();
    refreshTotalCellOptions(true);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener(LEAVE_TOOLS_EVENT, handleLeaveToolsPage);
    loadData();
    void monitorRuntime.refreshStatus();
    monitorRuntime.ensureStreamConnected();
    removeMonitorSubscription = monitorRuntime.subscribe((message) => {
      if (!message || message.kind !== 'event') return;
      handleMonitorPayload(message.payload);
    });
  });

  onBeforeUnmount(() => {
    stopPriceSearch();
    stopEstimationWorker();
    clearPendingEstimateRefresh();
    removeMonitorSubscription?.();
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener(LEAVE_TOOLS_EVENT, handleLeaveToolsPage);
  });

  if (profile.id === 'elsa') {
    watch(
      [() => summary.total, () => lastState.value],
      ([total, state]) => {
        syncElsaEstimateState(total, state);
      },
    );
    onUnmounted(() => { resetElsaEstimateState(); });
  }

  return {
    t,
    heroKey,
    groups,
    globalFields,
    qualityFields,
    resultColumns,
    globalInputs,
    groupInputs,
    groupPlaceholders,
    usesTotalCellSelect,
    selectedTotalCellsValue,
    totalCellOptions,
    totalCellsPlaceholder,
    totalAveragePlaceholder,
    summaryCards,
    tableRows,
    metaText,
    metaStatus,
    isLoading,
    monitorGridState,
    monitorStatus,
    monitorStatusText,
    monitorErrorText,
    monitorMinimumOccupied,
    monitorCells,
    monitorCellClassMap,
    monitorOutlineDetail,
    supportsGroupTotalPrice,
    handleSubmit,
    handleClear,
    resetPanelState,
    handleTotalAverageBlur,
    loadData,
    formatMoney,
    formatAverage,
    formatMonitorOutlineValue,
    getMonitorOutlineQualityClass,
    openMonitorOutlineDetail,
    closeMonitorOutlineDetail,
  };
}
