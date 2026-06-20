const { inferMinimumOccupiedCells } = require('./bidking-monitor-grid.js');
const {
  ETHAN_MONITOR_PROFILE,
  getBidKingHeroProfile,
} = require('./bidking-hero-profiles.js');

const GROUP_KEYS = ETHAN_MONITOR_PROFILE.groupKeys;

function createEmptyBidKingMonitorState(profileOrGameUid = ETHAN_MONITOR_PROFILE, maybeGameUid = undefined) {
  const { profile, gameUid } = resolveStateCreationArgs(profileOrGameUid, maybeGameUid);
  return {
    profileId: profile.id,
    gameUid,
    round: null,
    groups: Object.fromEntries(profile.groupKeys.map((group) => [group, {
      totalCells: null,
      averageCells: null,
      averagePrice: null,
    }])),
    completeRevealGroups: [],
    outlines: [],
    exactItems: [],
    qualityCells: [],
    revealedTypes: [],
    minimumOccupied: null,
    warnings: [],
    seenFactKeys: [],
  };
}

function applyBidKingMonitorFacts(
  currentState = createEmptyBidKingMonitorState(),
  facts = [],
  profile = getBidKingHeroProfile(currentState?.profileId || ETHAN_MONITOR_PROFILE.id),
) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  let state = currentState?.profileId === resolvedProfile.id
    ? currentState
    : createEmptyBidKingMonitorState(resolvedProfile, currentState?.gameUid ?? null);

  for (const fact of facts) {
    if (!fact?.type) continue;

    if (fact.type === 'game.changed') {
      const nextGameUid = fact.gameUid ? String(fact.gameUid) : null;
      if (nextGameUid && nextGameUid !== state.gameUid) {
        state = state.gameUid === null
          ? { ...state, gameUid: nextGameUid }
          : createEmptyBidKingMonitorState(resolvedProfile, nextGameUid);
      }
      if (fact.round !== undefined) state = { ...state, round: fact.round };
      continue;
    }

    const factGameUid = fact.gameUid ? String(fact.gameUid) : null;
    if (factGameUid && factGameUid !== state.gameUid) {
      state = createEmptyBidKingMonitorState(resolvedProfile, factGameUid);
    }

    const factKey = getFactKey(fact, state.gameUid);
    if (state.seenFactKeys.includes(factKey)) continue;
    state = { ...state, seenFactKeys: [...state.seenFactKeys, factKey] };

    if (fact.type === 'group.totalCellsKnown') {
      state = setGroupValue(state, fact.group, 'totalCells', fact.value);
    } else if (fact.type === 'group.averageCellsKnown') {
      state = setGroupValue(state, fact.group, 'averageCells', fact.value);
    } else if (fact.type === 'group.averagePriceKnown') {
      state = setGroupValue(state, fact.group, 'averagePrice', fact.value);
    } else if (fact.type === 'group.completeReveal') {
      state = setGroupCompleteReveal(state, fact.group);
    } else if (fact.type === 'type.revealed') {
      state = { ...state, revealedTypes: mergeStrings(state.revealedTypes, fact.itemTypes ?? []) };
    } else if (fact.type === 'item.qualityCellsRevealed') {
      state = { ...state, qualityCells: mergeQualityCells(state.qualityCells, fact) };
    } else if (fact.type === 'item.outlineRevealed') {
      state = { ...state, outlines: mergeOutlines(state.outlines, [factToOutline(fact)]) };
    } else if (fact.type === 'item.exactRevealed') {
      state = { ...state, exactItems: mergeExactItems(state.exactItems, fact) };
    }

    state = finalizeDerivedState(state, resolvedProfile);
  }
  return state;
}

function getFactKey(fact, gameUid = null) {
  const key = fact.key || `${fact.type}:${JSON.stringify(fact)}`;
  const scopedKey = gameUid ? `${gameUid}:${key}` : key;
  const payloadSignature = fact.source?.payloadSignature;
  return payloadSignature ? `${scopedKey}:${payloadSignature}` : scopedKey;
}

function setGroupValue(state, group, field, value) {
  if (!state?.groups?.[group]) return state;
  return {
    ...state,
    groups: {
      ...state.groups,
      [group]: {
        ...state.groups[group],
        [field]: Number(value),
      },
    },
  };
}

function setGroupCompleteReveal(state, group) {
  if (!state?.groups?.[group] || state.completeRevealGroups.includes(group)) return state;
  return {
    ...state,
    completeRevealGroups: [...state.completeRevealGroups, group],
  };
}

function mergeStrings(current, next) {
  return [...new Set([...(current ?? []), ...(next ?? []).map(String)])];
}

function mergeQualityCells(current, fact) {
  const byCell = new Map((current ?? []).map((entry) => [entry.cell, entry]));
  for (const cell of getValidCells(fact.cells)) {
    byCell.set(cell, {
      cell,
      qualityId: fact.quality?.id,
      qualityName: fact.quality?.name,
      qualityGroup: fact.quality?.group,
    });
  }
  return [...byCell.values()].sort((left, right) => left.cell - right.cell);
}

function factToOutline(fact) {
  const boxId = Number(fact.boxId);
  const protocolBoxId = fact.protocolBoxId ?? (Number.isFinite(boxId) ? boxId - 1 : undefined);
  const width = Number(fact.width);
  const height = Number(fact.height);
  return {
    boxId: fact.boxId,
    protocolBoxId,
    row: Number.isFinite(boxId) ? Math.floor((boxId - 1) / 10) + 1 : undefined,
    column: Number.isFinite(boxId) ? ((boxId - 1) % 10) + 1 : undefined,
    width: fact.width,
    height: fact.height,
    label: fact.label ?? (Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : undefined),
    cells: fact.cells,
    qualityId: fact.quality?.id,
    qualityName: fact.quality?.name,
    qualityGroup: fact.quality?.group,
    qualityStatus: fact.quality?.group ? 'confirmed' : undefined,
    qualitySource: fact.quality?.group ? 'direct' : undefined,
    itemCid: fact.itemCid,
    itemName: fact.itemName,
    price: fact.itemPrice ?? fact.price,
  };
}

function mergeOutlines(current, next) {
  const byKey = new Map((current ?? []).map((outline) => [getOutlineKey(outline), outline]));
  for (const outline of next) {
    const key = resolveOutlineMergeKey(byKey, outline);
    byKey.set(key, mergeDefinedValues(byKey.get(key), outline));
  }
  return [...byKey.values()].sort((left, right) => Number(left.boxId) - Number(right.boxId));
}

function resolveOutlineMergeKey(byKey, outline) {
  if (outline.label !== undefined) return getOutlineKey(outline);
  const sameBoxKeys = [...byKey.entries()]
    .filter(([, existing]) => existing.boxId === outline.boxId)
    .map(([key]) => key);
  return sameBoxKeys.length === 1 ? sameBoxKeys[0] : getOutlineKey(outline);
}

function mergeDefinedValues(current = {}, next = {}) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function getOutlineKey(outline) {
  return `${outline.boxId}:${outline.label}`;
}

function mergeExactItems(current, fact) {
  const key = `${fact.itemCid ?? fact.itemName}:${(fact.cells ?? []).join(',')}`;
  const byKey = new Map((current ?? []).map((item) => [item.key, item]));
  byKey.set(key, { ...fact, key });
  return [...byKey.values()];
}

function finalizeDerivedState(state, profile = ETHAN_MONITOR_PROFILE) {
  const outlines = applyExactItemsToOutlines(state.outlines, state.exactItems)
    .map((outline) => applyOutlineQuality(outline, state.qualityCells));
  const groups = applyCompleteRevealTotals(state.groups, outlines, state.completeRevealGroups, profile);
  const minimumOccupiedOutlines = outlines.filter(hasValidOutlineCells);
  return {
    ...state,
    groups,
    outlines,
    minimumOccupied: inferMinimumOccupiedCells({ outlines: minimumOccupiedOutlines }),
  };
}

function applyCompleteRevealTotals(groups, outlines, completeRevealGroups, profile) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  if (!groups || !Array.isArray(completeRevealGroups) || completeRevealGroups.length === 0) {
    return groups;
  }

  let nextGroups = groups;
  for (const group of completeRevealGroups) {
    if (!resolvedProfile.completeRevealGroups.has(group) || !nextGroups?.[group]) continue;

    const totalCells = getCompleteRevealTotalCells(outlines, group);
    if (totalCells === null) continue;

    nextGroups = {
      ...nextGroups,
      [group]: {
        ...nextGroups[group],
        totalCells,
      },
    };
  }

  return nextGroups;
}

function getCompleteRevealTotalCells(outlines, group) {
  const cells = new Set();
  for (const outline of outlines ?? []) {
    if (outline?.qualityGroup !== group) continue;
    for (const cell of getValidOutlineCells(outline)) {
      cells.add(cell);
    }
  }
  return cells.size;
}

function applyExactItemsToOutlines(outlines, exactItems) {
  if (!Array.isArray(exactItems) || exactItems.length === 0) return outlines;
  return (outlines ?? []).map((outline) => {
    const exactItem = exactItems.find((item) => exactItemMatchesOutline(item, outline));
    if (!exactItem) return outline;
    return {
      ...outline,
      itemCid: exactItem.itemCid,
      itemName: exactItem.itemName,
      price: exactItem.itemPrice ?? exactItem.price,
      qualityId: exactItem.quality?.id ?? outline.qualityId,
      qualityName: exactItem.quality?.name ?? outline.qualityName,
      qualityGroup: exactItem.quality?.group ?? outline.qualityGroup,
      qualityStatus: exactItem.quality?.group ? 'confirmed' : outline.qualityStatus,
      qualitySource: exactItem.quality?.group ? 'direct' : outline.qualitySource,
    };
  });
}

function exactItemMatchesOutline(item, outline) {
  const itemCells = getValidCells(item?.cells);
  const outlineCells = getValidOutlineCells(outline);
  if (sameCellSet(itemCells, outlineCells)) return true;

  const itemOriginCell = itemCells.length > 0 ? itemCells[0] : null;
  const outlineBoxId = Number(outline?.boxId);
  return itemOriginCell !== null &&
    Number.isFinite(outlineBoxId) &&
    itemOriginCell === outlineBoxId &&
    Number(item?.width) === Number(outline?.width) &&
    Number(item?.height) === Number(outline?.height);
}

function sameCellSet(leftCells, rightCells) {
  if (leftCells.length === 0 || leftCells.length !== rightCells.length) return false;
  const right = new Set(rightCells);
  return leftCells.every((cell) => right.has(cell));
}

function applyOutlineQuality(outline, qualityCells) {
  const outlineCells = getValidOutlineCells(outline);
  const hits = (qualityCells ?? []).filter((entry) => outlineCells.includes(entry.cell));
  const qualities = [
    ...(outline.qualitySource === 'direct' ? [outlineToQuality(outline)] : []),
    ...hits,
  ].filter(hasQualityIdentity);
  const identities = [...new Set(qualities.map(getQualityIdentity))];

  if (identities.length === 1) {
    const hit = qualities.find((entry) => getQualityIdentity(entry) === identities[0]);
    return {
      ...outline,
      qualityId: hit.qualityId,
      qualityName: hit.qualityName,
      qualityGroup: hit.qualityGroup,
      qualityStatus: 'confirmed',
    };
  }
  if (identities.length > 1) {
    return {
      ...outline,
      qualityId: undefined,
      qualityName: undefined,
      qualityGroup: undefined,
      qualityStatus: 'conflict',
    };
  }

  const { qualityId: _qualityId, qualityName: _qualityName, qualityGroup: _qualityGroup, qualityStatus: _qualityStatus, ...baseOutline } = outline;
  return baseOutline;
}

function hasValidOutlineCells(outline) {
  return getValidOutlineCells(outline).length > 0;
}

function getValidOutlineCells(outline) {
  return getValidCells(outline.cells);
}

function getValidCells(cells) {
  return (Array.isArray(cells) ? cells : [])
    .filter((cell) => Number.isInteger(cell) && cell >= 1 && cell <= 430);
}

function outlineToQuality(outline) {
  return {
    qualityId: outline.qualityId,
    qualityName: outline.qualityName,
    qualityGroup: outline.qualityGroup,
  };
}

function hasQualityIdentity(quality) {
  return quality.qualityId !== undefined || Boolean(quality.qualityName);
}

function getQualityIdentity(quality) {
  if (quality.qualityId !== undefined) return `id:${quality.qualityId}`;
  return `name:${quality.qualityName}`;
}

function resolveStateCreationArgs(profileOrGameUid, maybeGameUid) {
  if (maybeGameUid !== undefined) {
    return {
      profile: getBidKingHeroProfile(profileOrGameUid),
      gameUid: normalizeGameUid(maybeGameUid),
    };
  }

  if (isProfileReference(profileOrGameUid)) {
    return {
      profile: getBidKingHeroProfile(profileOrGameUid),
      gameUid: null,
    };
  }

  return {
    profile: ETHAN_MONITOR_PROFILE,
    gameUid: normalizeGameUid(profileOrGameUid),
  };
}

function isProfileReference(value) {
  return (value && typeof value === 'object' && Array.isArray(value.groupKeys)) ||
    value === 'ethan' ||
    value === 'elsa';
}

function normalizeGameUid(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

module.exports = {
  GROUP_KEYS,
  createEmptyBidKingMonitorState,
  applyBidKingMonitorFacts,
};
