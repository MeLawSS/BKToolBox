import {
  ESTIMATION_GROUPS,
  PER_CELL_EXPECTED,
  cloneStateWithGroupCandidates,
  cloneStateWithGroupCells,
  estimateGroupValue,
  estimateTotalByStage,
  findTotalForAveragePrice,
  findFirstAveragePriceCellMatch,
  getEffectiveMaxCells,
  getAverageOnlyPredictions,
  getCombinedAverageOnlyPredictions,
  getPossibleCellsFromAverage,
  getRoundedTarget,
  hasMatchingAveragePriceCombination,
  parseComboOutputLine,
} from './estimator.js';

export const DEFAULT_ESTIMATION_OUTPUT_LIMIT = 30;
export const DEFAULT_PREDICTION_GROUP_KEYS = ['purple', 'orange'];
export const DEFAULT_PRICE_COMBO_MIN_CELL_SPACING = 4;

function getGroupByKey(groupKey, groups = ESTIMATION_GROUPS) {
  return groups.find((group) => group.key === groupKey);
}

export function applyAveragePriceCellMatchOverridesForWorker(
  state,
  collectibleItemsByGroup,
  groups = ESTIMATION_GROUPS,
  skipGroupKeys = []
) {
  const stateGroups = Object.fromEntries(groups.map((group) => [
    group.key,
    { ...state.groups[group.key] },
  ]));
  const missingMatches = [];
  let hasOverride = false;

  for (const group of groups) {
    if (skipGroupKeys.includes(group.key)) continue;
    const input = stateGroups[group.key];
    if (
      input.cells === null ||
      input.priceAverage === null ||
      input.count !== null ||
      Number.isFinite(input.valueOverride)
    ) {
      continue;
    }

    const match = findFirstAveragePriceCellMatch(
      collectibleItemsByGroup?.[group.key] ?? [],
      input.cells,
      input.priceAverage
    );
    if (!match) {
      missingMatches.push({
        labelKey: group.labelKey,
        cells: input.cells,
      });
      continue;
    }

    stateGroups[group.key] = {
      ...input,
      count: match.count,
      valueOverride: match.totalPrice,
      valueSource: 'averagePriceCombo',
    };
    hasOverride = true;
  }

  return {
    state: hasOverride ? { ...state, groups: stateGroups } : state,
    missingMatches,
  };
}

function getMatchedGroupKeys(item, groupKeys, collectibleItemsByGroup) {
  const matched = [];
  for (const groupKey of groupKeys) {
    const candidate = item.candidatesByGroup?.[groupKey];
    const group = item.state.groups[groupKey];
    if (!candidate || group?.priceAverage === null) continue;
    if (hasMatchingAveragePriceCombination(
      collectibleItemsByGroup?.[groupKey] ?? [],
      candidate,
      group.priceAverage
    )) {
      matched.push(groupKey);
    }
  }
  return matched;
}

export function calculateEstimationResult({
  state,
  predictionGroupKeys = DEFAULT_PREDICTION_GROUP_KEYS,
  collectibleItemsByGroup = {},
  priceProfilesByGroup = {},
  limit = DEFAULT_ESTIMATION_OUTPUT_LIMIT,
  groups = ESTIMATION_GROUPS,
  profile = null,
} = {}) {
  const resolvedGroups = groups ?? profile?.groups ?? ESTIMATION_GROUPS;
  const resolvedProfile = profile ?? undefined;
  const averagePriceMatch = applyAveragePriceCellMatchOverridesForWorker(
    state,
    collectibleItemsByGroup,
    resolvedGroups,
    predictionGroupKeys
  );
  if (averagePriceMatch.missingMatches.length > 0) {
    return {
      type: 'empty',
      reason: 'priceCellsNoMatch',
      status: 'status-warn',
      missing: averagePriceMatch.missingMatches[0],
    };
  }

  const matchedState = averagePriceMatch.state;
  const combinedPredictions = getCombinedAverageOnlyPredictions(
    matchedState,
    predictionGroupKeys,
    limit,
    resolvedProfile
  );
  if (combinedPredictions.length > 0) {
    const activeGroupKeys = predictionGroupKeys.filter((groupKey) =>
      combinedPredictions[0].candidatesByGroup[groupKey]
    );
    const rows = combinedPredictions.slice(0, limit).map((item) => {
      const nextState = cloneStateWithGroupCandidates(
        matchedState,
        item.candidatesByGroup,
        resolvedGroups,
        resolvedProfile,
      );
      const rowItem = {
        ...item,
        state: nextState,
        prediction: estimateTotalByStage(nextState, resolvedGroups, resolvedProfile),
      };
      return {
        item: rowItem,
        matchedGroupKeys: getMatchedGroupKeys(rowItem, activeGroupKeys, collectibleItemsByGroup),
      };
    });

    return {
      type: 'combined',
      state: matchedState,
      groupKeys: activeGroupKeys,
      rows,
    };
  }

  for (const groupKey of predictionGroupKeys) {
    const predictions = getAverageOnlyPredictions(
      matchedState,
      groupKey,
      [groupKey],
      resolvedProfile,
    );
    if (predictions.length > 0) {
      const rows = predictions.slice(0, limit).map((candidate, index) => {
        const nextState = cloneStateWithGroupCells(
          matchedState,
          groupKey,
          candidate,
          resolvedGroups,
          resolvedProfile,
        );
        const rowItem = {
          index: index + 1,
          state: nextState,
          prediction: estimateTotalByStage(nextState, resolvedGroups, resolvedProfile),
          candidatesByGroup: {
            [groupKey]: candidate,
          },
        };
        return {
          item: rowItem,
          matchedGroupKeys: getMatchedGroupKeys(rowItem, [groupKey], collectibleItemsByGroup),
        };
      });

      return {
        type: 'single',
        state: matchedState,
        groupKey,
        groupLabelKey: getGroupByKey(groupKey, resolvedGroups)?.labelKey,
        rows,
      };
    }
  }

  return {
    type: 'direct',
    state: matchedState,
    prediction: estimateTotalByStage(matchedState, resolvedGroups, resolvedProfile),
    groupRows: resolvedGroups.map((group) => estimateGroupValue(
      group,
      matchedState,
      priceProfilesByGroup,
      resolvedProfile,
    )),
  };
}

function getPredictionCompanion(state, config, candidate, predictionConfigs) {
  if (state.totalCells === null) return null;

  const configIndex = predictionConfigs.findIndex((entry) => entry.groupKey === config.groupKey);
  const companionConfig = predictionConfigs
    .slice(0, Math.max(0, configIndex))
    .findLast((entry) => {
      const group = state.groups[entry.groupKey];
      return group?.avg !== null && group.cells === null;
    });
  if (!companionConfig) return null;

  const group = state.groups[companionConfig.groupKey];
  const maxCompanionCells = state.totalCells - state.knownCells - candidate.cells;
  if (maxCompanionCells <= 0) return null;

  const candidates = getPossibleCellsFromAverage(group.avg, maxCompanionCells);
  return candidates.length ? { config: companionConfig, candidates } : null;
}

function getMonitorKnownCellsExcluding(state, excludedGroupKeys = []) {
  const excluded = new Set(excludedGroupKeys);
  return Object.entries(state.groups).reduce((sum, [key, group]) =>
    sum + (!excluded.has(key) && group.cells === null && group.monitorKnownCells > 0 ? group.monitorKnownCells : 0)
  , 0);
}

function hasTotalPriceConstraintFilters(state, config) {
  const group = state.groups[config.groupKey];
  return group.avg !== null || group.cells !== null || group.priceAverage !== null;
}

function hasPriceComboCellSpacing(candidate, rows, minSpacing) {
  return rows.every((row) => Math.abs(row.cells - candidate.cells) >= minSpacing);
}

function matchesTotalPriceCandidate(state, config, candidate, collectibleItemsByGroup, profile) {
  const group = state.groups[config.groupKey];
  if (
    !Number.isInteger(candidate?.count) ||
    candidate.count <= 0 ||
    !Number.isInteger(candidate?.cells) ||
    candidate.cells <= 0
  ) {
    return false;
  }
  if (group.cells !== null && candidate.cells !== group.cells) return false;
  if (group.avg !== null && getRoundedTarget(group.avg, candidate.count) !== candidate.cells) return false;
  if (group.priceAverage !== null) {
    const expectedTotalPrice = findTotalForAveragePrice(group.priceAverage, candidate.count);
    if (expectedTotalPrice === null || expectedTotalPrice !== candidate.totalPrice) return false;
    const groupItems = collectibleItemsByGroup?.[config.groupKey] ?? [];
    if (
      groupItems.length > 0 &&
      !hasMatchingAveragePriceCombination(groupItems, {
        count: candidate.count,
        cells: candidate.cells,
      }, group.priceAverage)
    ) {
      return false;
    }
  }
  if (group.monitorKnownCells > 0 && candidate.cells < group.monitorKnownCells) return false;

  if (group.cells === null) {
    const effectiveMax = getEffectiveMaxCells(state, profile);
    if (effectiveMax !== null) {
      const maxGroupCells = effectiveMax - state.knownCells - getMonitorKnownCellsExcluding(state, [config.groupKey]);
      if (candidate.cells > maxGroupCells) return false;
    }
  }

  return true;
}

function cloneStateWithGroupTotalPriceCandidate(state, groupKey, candidate, groups, profile) {
  const nextState = cloneStateWithGroupCells(state, groupKey, candidate, groups, profile);
  return {
    ...nextState,
    groups: {
      ...nextState.groups,
      [groupKey]: {
        ...nextState.groups[groupKey],
        totalPrice: candidate.totalPrice,
        valueOverride: candidate.totalPrice,
        valueSource: 'totalPrice',
      },
    },
  };
}

function buildTotalPriceStreamRow(state, config, candidate, groups, profile) {
  const nextState = cloneStateWithGroupTotalPriceCandidate(state, config.groupKey, candidate, groups, profile);
  const prediction = estimateTotalByStage(nextState, groups, profile);
  return {
    kind: 'total-price',
    groupKey: config.groupKey,
    count: candidate.count,
    cells: candidate.cells,
    avg: nextState.groups[config.groupKey].avg,
    low: prediction.total,
    mean: prediction.total,
    high: prediction.total,
    remaining: prediction.remaining,
    totalCount: nextState.totalCount,
    isOverflow: nextState.totalCells !== null && nextState.knownCells > nextState.totalCells,
    overflowTotal: nextState.knownCells,
    hasPriceMatch: state.groups[config.groupKey]?.priceAverage !== null,
  };
}

function buildPriceOnlyStreamRow(state, config, candidate, groups, profile, predictionConfigs) {
  const nextState = cloneStateWithGroupCells(state, config.groupKey, candidate, groups, profile);
  const companion = getPredictionCompanion(state, config, candidate, predictionConfigs);
  if (!companion) {
    const prediction = estimateTotalByStage(nextState, groups, profile);
    return {
      kind: 'price-only',
      groupKey: config.groupKey,
      count: candidate.count,
      cells: candidate.cells,
      avg: candidate.count > 0 ? candidate.cells / candidate.count : null,
      low: prediction.total,
      mean: prediction.total,
      high: prediction.total,
      remaining: prediction.remaining,
      totalCount: nextState.totalCount,
      isOverflow: nextState.totalCells !== null && nextState.knownCells > nextState.totalCells,
      overflowTotal: nextState.knownCells,
      companion: null,
    };
  }

  const predictions = companion.candidates.map((companionCandidate) => {
    const companionState = cloneStateWithGroupCells(nextState, companion.config.groupKey, companionCandidate, groups, profile);
    return {
      candidate: companionCandidate,
      prediction: estimateTotalByStage(companionState, groups, profile),
    };
  });
  const totals = predictions.map((entry) => entry.prediction.total);
  const remainders = predictions.map((entry) => entry.prediction.remaining);

  return {
    kind: 'price-only',
    groupKey: config.groupKey,
    count: candidate.count,
    cells: candidate.cells,
    avg: candidate.count > 0 ? candidate.cells / candidate.count : null,
    low: Math.min(...totals),
    mean: Math.round(totals.reduce((sum, total) => sum + total, 0) / totals.length),
    high: Math.max(...totals),
    totalCount: nextState.totalCount,
    isOverflow: nextState.totalCells !== null && nextState.knownCells > nextState.totalCells,
    overflowTotal: nextState.knownCells,
    companion: {
      groupKey: companion.config.groupKey,
      count: companion.candidates.length,
      minCount: Math.min(...companion.candidates.map((entry) => entry.count)),
      maxCount: Math.max(...companion.candidates.map((entry) => entry.count)),
      minCells: Math.min(...companion.candidates.map((entry) => entry.cells)),
      maxCells: Math.max(...companion.candidates.map((entry) => entry.cells)),
      minRemaining: Math.min(...remainders),
      maxRemaining: Math.max(...remainders),
    },
  };
}

export function createStreamRun({
  runId,
  streamMode,
  state,
  config,
  groups = ESTIMATION_GROUPS,
  profile = null,
  collectibleItemsByGroup = {},
  predictionConfigs = [],
  limit = DEFAULT_ESTIMATION_OUTPUT_LIMIT,
  minCellSpacing = DEFAULT_PRICE_COMBO_MIN_CELL_SPACING,
} = {}) {
  return {
    runId,
    streamMode,
    state,
    config,
    groups,
    profile,
    collectibleItemsByGroup,
    predictionConfigs,
    limit,
    minCellSpacing,
    rows: [],
    seenCells: new Set(),
    seenCandidates: new Set(),
    pendingText: '',
    sawParsedCandidate: false,
    matchedCandidate: false,
  };
}

function appendParsedPriceOnlyCandidate(streamRun, parsed) {
  const effectiveMax = getEffectiveMaxCells(streamRun.state, streamRun.profile) ?? streamRun.state.totalCells;
  const maxGroupCells = effectiveMax === null ? Infinity : effectiveMax - streamRun.state.knownCells;
  if (parsed.cells > maxGroupCells) return null;
  if (streamRun.seenCells.has(parsed.cells)) return null;
  if (!hasPriceComboCellSpacing(parsed, streamRun.rows, streamRun.minCellSpacing)) return null;

  streamRun.seenCells.add(parsed.cells);
  const row = buildPriceOnlyStreamRow(
    streamRun.state,
    streamRun.config,
    { cells: parsed.cells, count: parsed.count },
    streamRun.groups,
    streamRun.profile,
    streamRun.predictionConfigs,
  );
  streamRun.rows.push(row);
  return row;
}

function appendParsedTotalPriceCandidate(streamRun, parsed) {
  streamRun.sawParsedCandidate = true;
  if (!matchesTotalPriceCandidate(
    streamRun.state,
    streamRun.config,
    parsed,
    streamRun.collectibleItemsByGroup,
    streamRun.profile,
  )) {
    return null;
  }

  const candidateKey = `${parsed.count}:${parsed.cells}`;
  if (streamRun.seenCandidates.has(candidateKey)) return null;
  streamRun.seenCandidates.add(candidateKey);
  streamRun.matchedCandidate = true;

  const row = buildTotalPriceStreamRow(
    streamRun.state,
    streamRun.config,
    {
      count: parsed.count,
      cells: parsed.cells,
      totalPrice: parsed.totalPrice,
    },
    streamRun.groups,
    streamRun.profile,
  );
  streamRun.rows.push(row);
  return row;
}

function processStreamLine(streamRun, line) {
  const parsed = parseComboOutputLine(line);
  if (!parsed) return null;
  if (streamRun.rows.length >= streamRun.limit) return null;
  if (streamRun.streamMode === 'price-only') {
    return appendParsedPriceOnlyCandidate(streamRun, parsed);
  }
  return appendParsedTotalPriceCandidate(streamRun, parsed);
}

export function appendStreamRunSource(streamRun, text) {
  const input = `${streamRun.pendingText}${String(text ?? '')}`;
  const rows = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== '\n') continue;
    const row = processStreamLine(streamRun, input.slice(start, index));
    if (row) rows.push(row);
    start = index + 1;
    if (streamRun.rows.length >= streamRun.limit) break;
  }
  streamRun.pendingText = input.slice(start);
  return rows;
}

export function runPriceMatchPhase({
  result,
  state,
  collectibleItemsByGroup,
  predictionGroupKeys,
  profile,
  runId,
  postMessage,
}) {
  if (result.type !== 'direct' && result.type !== 'single') {
    postMessage({ type: 'price-match-done', runId });
    return;
  }

  for (const groupKey of predictionGroupKeys) {
    const priceAverage = state.groups[groupKey]?.priceAverage;
    if (priceAverage == null) continue;
    const items = collectibleItemsByGroup[groupKey] ?? [];
    if (!items.length) continue;

    if (result.type === 'direct') {
      const groupState = state.groups[groupKey];
      const cells = groupState?.cells;
      if (cells == null) continue;
      if (groupState?.valueSource === 'totalPrice') continue;

      const count = groupState?.count ?? null;
      let totalPrice = null;
      if (count !== null) {
        const tp = findTotalForAveragePrice(priceAverage, count);
        if (tp !== null && hasMatchingAveragePriceCombination(items, { count, cells }, priceAverage)) {
          totalPrice = tp;
        }
      } else {
        const match = findFirstAveragePriceCellMatch(items, cells, priceAverage);
        if (match) totalPrice = match.totalPrice;
      }

      if (totalPrice === null) continue;

      const oldValue = Number.isFinite(groupState?.valueOverride)
        ? groupState.valueOverride
        : (count !== null && count > 0)
          ? priceAverage * count
          : cells * (profile?.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0);
      postMessage({ type: 'price-match-update', runId, groupKey, rowIndex: null, delta: totalPrice - oldValue });
    }

    if (result.type === 'single') {
      for (let i = 0; i < result.rows.length; i++) {
        const rowItem = result.rows[i].item;
        const candidate = rowItem.candidatesByGroup[groupKey];
        const groupState = rowItem.state.groups[groupKey];

        let count, cells;
        if (candidate !== undefined) {
          count = candidate.count;
          cells = candidate.cells;
        } else {
          cells = groupState?.cells;
          count = groupState?.count ?? null;
          if (cells == null) continue;
        }

        if (groupState?.valueSource === 'totalPrice') continue;

        let totalPrice = null;
        if (count !== null) {
          const tp = findTotalForAveragePrice(priceAverage, count);
          if (tp !== null && hasMatchingAveragePriceCombination(items, { count, cells }, priceAverage)) {
            totalPrice = tp;
          }
        } else {
          const match = findFirstAveragePriceCellMatch(items, cells, priceAverage);
          if (match) totalPrice = match.totalPrice;
        }

        if (totalPrice === null) continue;

        const oldValue = Number.isFinite(groupState?.valueOverride)
          ? groupState.valueOverride
          : (count !== null && count > 0)
            ? priceAverage * count
            : cells * (profile?.perCellExpected?.[groupKey] ?? PER_CELL_EXPECTED[groupKey] ?? 0);
        postMessage({ type: 'price-match-update', runId, groupKey, rowIndex: i, delta: totalPrice - oldValue });
      }
    }
  }

  postMessage({ type: 'price-match-done', runId });
}

export function finishStreamRun(streamRun, reason = 'done') {
  let finalRow = null;
  if (streamRun.pendingText) {
    finalRow = processStreamLine(streamRun, streamRun.pendingText);
    streamRun.pendingText = '';
  }

  let emptyReason = null;
  if (streamRun.rows.length === 0) {
    if (streamRun.streamMode === 'price-only') {
      emptyReason = 'no-results';
    } else if (streamRun.sawParsedCandidate && !streamRun.matchedCandidate && hasTotalPriceConstraintFilters(streamRun.state, streamRun.config)) {
      emptyReason = streamRun.state.groups[streamRun.config.groupKey]?.priceAverage !== null
        ? 'average-price-conflict'
        : 'constraint-conflict';
    } else {
      emptyReason = 'no-results';
    }
  }

  return {
    streamMode: streamRun.streamMode,
    groupKey: streamRun.config.groupKey,
    count: streamRun.rows.length,
    reason,
    emptyReason,
    finalRow,
  };
}
