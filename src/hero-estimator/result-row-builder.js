export function buildPredictionRow(index, item, config, t, keyFor, label = null) {
  const group = item.state.groups[config.groupKey];
  const prediction = item.prediction;
  const totalCountText = item.state.totalCount === null ? '-' : item.state.totalCount;
  const rowLabel = label ?? t(keyFor('status.groupPredictionLabel'), { label: t(config.labelKey) });
  const isOverflow = item.state.totalCells !== null && item.state.knownCells > item.state.totalCells;
  return {
    label: t(keyFor('status.plan'), { index }),
    count: group.count,
    cells: group.cells,
    avg: group.avg,
    low: prediction.total,
    mean: prediction.total,
    high: prediction.total,
    status: t(keyFor('status.planDetail'), { label: rowLabel, remaining: prediction.remaining, totalCount: totalCountText }),
    statusClass: isOverflow ? 'status-over' : 'status-ok',
    tags: isOverflow ? [t(keyFor('status.overflowCells'), { total: item.state.knownCells })] : [],
    predictionGroupKey: config.groupKey,
    predictionCandidates: {
      [config.groupKey]: {
        count: group.count,
        cells: group.cells,
      },
    },
  };
}

export function buildCombinedPredictionRow(index, item, configs, t, keyFor) {
  const prediction = item.prediction;
  const totalCountText = item.state.totalCount === null ? '-' : item.state.totalCount;
  const candidates = item.candidatesByGroup;
  const totalCount = Object.values(candidates).reduce((sum, candidate) => sum + candidate.count, 0);
  const totalCells = Object.values(candidates).reduce((sum, candidate) => sum + candidate.cells, 0);
  const detailText = configs
    .filter((config) => candidates[config.groupKey])
    .map((config) => {
      const candidate = candidates[config.groupKey];
      return t(keyFor('status.combinedItem'), { label: t(config.labelKey), count: candidate.count, cells: candidate.cells });
    })
    .join('；');
  const isOverflow = item.state.totalCells !== null && item.state.knownCells > item.state.totalCells;
  return {
    label: t(keyFor('status.plan'), { index }),
    count: totalCount,
    cells: totalCells,
    avg: totalCount > 0 ? totalCells / totalCount : null,
    low: prediction.total,
    mean: prediction.total,
    high: prediction.total,
    status: t(keyFor('status.combinedDetail'), { detail: detailText, remaining: prediction.remaining, totalCount: totalCountText }),
    statusClass: isOverflow ? 'status-over' : 'status-ok',
    tags: isOverflow ? [t(keyFor('status.overflowCells'), { total: item.state.knownCells })] : [],
    predictionGroupKeys: Object.keys(candidates),
    predictionCandidates: candidates,
  };
}

export function withAverageMatchTags(row, matchedGroupKeys, configs, t, keyFor) {
  if (!matchedGroupKeys?.length) return row;
  const configByGroup = new Map(configs.map((config) => [config.groupKey, config]));
  const isCombined = configs.length > 1;
  const tags = matchedGroupKeys.map((groupKey) => {
    const config = configByGroup.get(groupKey);
    if (!isCombined || !config) return t(keyFor('status.priceMatchTag'));
    return t(keyFor('status.groupPriceMatchTag'), { label: t(config.labelKey) });
  });
  return {
    ...row,
    tags: [...new Set([...(row.tags ?? []), ...tags])],
  };
}
