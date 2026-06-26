const { MONITOR_GRID_COLUMNS, MONITOR_GRID_ROWS, parseSlotType } = require('./bidking-monitor-grid.js');
const {
  ETHAN_MONITOR_PROFILE,
  getBidKingHeroProfile,
  resolveQualityGroupFromId,
  resolveQualityGroupFromName,
} = require('./bidking-hero-profiles.js');

const KNOWN_AGGREGATE_SKILLS = new Map([
  [200010, { group: 'purple', factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' }],
  [200011, { group: 'orange', factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' }],
  [200012, { group: 'red', factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' }],
  [200013, { group: 'purple', factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' }],
  [200015, { group: 'orange', factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' }],
  [200016, { group: 'red', factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' }],
  [200036, { group: 'purple', factType: 'group.averagePriceKnown', valueKey: 'allHitItemAvgPrice' }],
  [200037, { group: 'orange', factType: 'group.averagePriceKnown', valueKey: 'allHitItemAvgPrice' }],
  [200038, { group: 'red', factType: 'group.averagePriceKnown', valueKey: 'allHitItemAvgPrice' }],
]);
const QUALITY_NAME_BY_ID = {
  1: '白',
  2: '绿',
  3: '蓝',
  4: '紫',
  5: '金',
  6: '红',
};

function buildBidKingMonitorFacts(rawEvent, profile = ETHAN_MONITOR_PROFILE) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  const event = rawEvent?.rawEvent ?? rawEvent;
  if (!event?.skill) return [];

  const skill = event.skill;
  const source = buildFactSource(event);
  const facts = [];

  if (event.gameUid) {
    facts.push({
      type: 'game.changed',
      key: `${source.key}:game`,
      gameUid: String(event.gameUid),
      round: event.round ?? null,
      source,
    });
  }

  const itemTypes = getRevealedTypes(skill);
  if (itemTypes.length) {
    facts.push({
      type: 'type.revealed',
      key: `${source.key}:types`,
      gameUid: event.gameUid ? String(event.gameUid) : null,
      itemTypes,
      source,
    });
  }

  facts.push(...buildItemFacts(event, source, resolvedProfile));

  const aggregateFact = buildAggregateFact(event, source, resolvedProfile);
  if (aggregateFact) {
    facts.push(aggregateFact);

    if (
      aggregateFact.type === 'group.averageCellsKnown' &&
      aggregateFact.group === 'orange' &&
      aggregateFact.value === 0
    ) {
      facts.push({
        type: 'group.totalCellsKnown',
        key: `${source.key}:group.totalCellsKnown:orange`,
        gameUid: event.gameUid ? String(event.gameUid) : null,
        group: 'orange',
        value: 0,
        source,
      });
    }
  }

  return facts;
}

function buildFactSource(event) {
  const skill = event?.skill ?? {};
  const key = String(event?.key ?? skill.uid ?? skill.itemCid ?? skill.skillCid ?? 'unknown');
  return {
    key,
    eventKey: event?.key ?? null,
    skillUid: skill.uid ?? null,
    skillCid: skill.skillCid ?? null,
    itemCid: skill.itemCid ?? null,
    payloadSignature: buildFactPayloadSignature(event),
  };
}

function buildFactPayloadSignature(event) {
  const skill = event?.skill ?? {};
  return JSON.stringify({
    group: event?.group ?? '',
    round: event?.round ?? '',
    skillCid: skill.skillCid ?? '',
    itemCid: skill.itemCid ?? '',
    castRound: skill.castRound ?? '',
    totalHitBoxIndex: skill.totalHitBoxIndex ?? '',
    hitItemTotalPrice: skill.hitItemTotalPrice ?? '',
    allHitItemAvgPrice: skill.allHitItemAvgPrice ?? '',
    allHitBoxAvgPrice: skill.allHitBoxAvgPrice ?? '',
    allHitItemAvgBoxIndex: skill.allHitItemAvgBoxIndex ?? '',
    hitItemTypeList: skill.hitItemTypeList ?? [],
    hitItemQuilityList: skill.hitItemQuilityList ?? [],
    hitBoxList: (skill.hitBoxList ?? []).map((box) => ({
      boxId: box.boxId ?? null,
      itemCid: box.itemCid ?? null,
      itemName: box.itemName ?? null,
      itemPrice: box.itemPrice ?? box.price ?? null,
      itemSlotType: box.itemSlotType ?? null,
      itemQuility: box.itemQuility ?? box.itemQuality ?? box.qualityId ?? null,
      itemQuilityName: box.itemQuilityName ?? box.itemQualityName ?? box.quality ?? null,
      itemBoxIndex: box.itemBoxIndex ?? null,
    })),
  });
}

function getRevealedTypes(skill) {
  if (Array.isArray(skill?.hitItemTypeNames) && skill.hitItemTypeNames.length) {
    return skill.hitItemTypeNames.map(String);
  }
  if (Array.isArray(skill?.hitItemTypeList) && skill.hitItemTypeList.length) {
    return skill.hitItemTypeList.map(String);
  }
  return [];
}

function buildItemFacts(event, source, profile) {
  const hitBoxList = Array.isArray(event.skill?.hitBoxList) ? event.skill.hitBoxList : [];
  const facts = [];
  const completeRevealGroups = new Set();
  const completeRevealGroup = getCompleteRevealGroup(event, profile);
  if (completeRevealGroup) completeRevealGroups.add(completeRevealGroup);

  for (const [index, box] of hitBoxList.entries()) {
    const quality = getBoxQuality(box, profile);
    const originCell = getOriginCell(box);
    const shape = buildBoxShape(box);

    if (quality && originCell !== null) {
      facts.push({
        type: 'item.qualityCellsRevealed',
        key: `${source.key}:quality:${index}`,
        gameUid: event.gameUid ? String(event.gameUid) : null,
        cells: [originCell],
        quality,
        source,
      });
    }

    if (shape) {
      facts.push({
        type: 'item.outlineRevealed',
        key: `${source.key}:outline:${index}`,
        gameUid: event.gameUid ? String(event.gameUid) : null,
        cells: shape.cells,
        boxId: shape.boxId,
        width: shape.width,
        height: shape.height,
        quality,
        ...getExactItemFields(box),
        source,
      });
    }

    const exactCells = getExactItemCells(box, shape, originCell);
    if ((box?.itemCid !== undefined || box?.itemName) && exactCells) {
      facts.push({
        type: 'item.exactRevealed',
        key: `${source.key}:exact:${index}`,
        gameUid: event.gameUid ? String(event.gameUid) : null,
        ...getExactItemFields(box),
        cells: exactCells,
        width: shape?.width ?? null,
        height: shape?.height ?? null,
        quality,
        source,
      });
    }

    if (!completeRevealGroup && isCompleteRevealFact(event, quality?.group, profile)) {
      completeRevealGroups.add(quality.group);
    }
  }

  for (const group of completeRevealGroups) {
    facts.push({
      type: 'group.completeReveal',
      key: `${source.key}:complete:${group}`,
      gameUid: event.gameUid ? String(event.gameUid) : null,
      group,
      source,
    });
  }

  return facts;
}

function getExactItemFields(box) {
  if (
    box?.itemCid === undefined &&
    !box?.itemName &&
    box?.itemPrice === undefined &&
    box?.price === undefined
  ) {
    return {};
  }
  return {
    itemCid: normalizeOptionalNumber(box?.itemCid),
    itemName: box?.itemName ? String(box.itemName) : null,
    itemPrice: normalizeOptionalNumber(box?.itemPrice ?? box?.price),
  };
}

function getOriginCell(box) {
  const protocolBoxId = normalizeProtocolBoxId(box?.boxId);
  return protocolBoxId === null ? null : protocolBoxId + 1;
}

function buildBoxShape(box) {
  const protocolBoxId = normalizeProtocolBoxId(box?.boxId);
  const size = parseSlotType(box?.itemSlotType);
  if (protocolBoxId === null || !size) return null;

  const startRow = Math.floor(protocolBoxId / MONITOR_GRID_COLUMNS) + 1;
  const startColumn = (protocolBoxId % MONITOR_GRID_COLUMNS) + 1;
  if (startColumn + size.width - 1 > MONITOR_GRID_COLUMNS) return null;
  if (startRow + size.height - 1 > MONITOR_GRID_ROWS) return null;

  const startCell = protocolBoxId + 1;
  const cells = [];
  for (let rowOffset = 0; rowOffset < size.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < size.width; columnOffset += 1) {
      cells.push(startCell + rowOffset * MONITOR_GRID_COLUMNS + columnOffset);
    }
  }

  return {
    boxId: startCell,
    width: size.width,
    height: size.height,
    cells,
  };
}

function normalizeProtocolBoxId(value) {
  const protocolBoxId = value === undefined || value === null ? 0 : Number(value);
  if (!Number.isInteger(protocolBoxId) || protocolBoxId < 0 || protocolBoxId >= MONITOR_GRID_ROWS * MONITOR_GRID_COLUMNS) {
    return null;
  }
  return protocolBoxId;
}

function getExactItemCells(box, shape, originCell) {
  if (hasSlotType(box)) return shape?.cells ?? null;
  return originCell === null ? null : [originCell];
}

function hasSlotType(box) {
  return box?.itemSlotType !== undefined && box?.itemSlotType !== null && String(box.itemSlotType).trim() !== '';
}

function getBoxQuality(box, profile) {
  const rawId = box?.itemQuility ?? box?.itemQuality ?? box?.qualityId;
  const rawName = box?.itemQuilityName ?? box?.itemQualityName ?? box?.quality;
  if (rawId === undefined && rawName === undefined) return null;

  const id = normalizeOptionalNumber(rawId);
  const name = resolveQualityDisplayName(id, rawName);
  return {
    id,
    name,
    group: getQualityGroupFromId(id, profile) || getQualityGroupFromName(name, profile),
  };
}

function resolveQualityDisplayName(id, rawName) {
  const normalizedName = rawName === undefined || rawName === null ? '' : String(rawName).trim();
  if (normalizedName) return normalizedName;
  if (id !== null && QUALITY_NAME_BY_ID[id]) return QUALITY_NAME_BY_ID[id];
  return id === null ? null : String(id);
}

function buildAggregateFact(event, source, profile) {
  const skill = event.skill;
  const sourceIds = getSourceIds(skill);
  const sourceIdFact = buildSourceIdAggregateFact(event, source, sourceIds, profile);
  if (sourceIdFact) return sourceIdFact;

  const zeroCountFact = buildZeroCountTotalCellsFact(event, source, profile, sourceIds);
  if (zeroCountFact) return zeroCountFact;

  const group = getAggregateGroup(skill, profile, []);
  if (!group) return null;

  const name = getSkillName(skill);
  if (isTotalCellsSkillName(name)) {
    const totalFact = buildGroupFact(event, source, 'group.totalCellsKnown', group, skill.totalHitBoxIndex);
    if (totalFact) return totalFact;
  }
  if (isAverageCellsSkillName(name)) {
    const averageFact = buildGroupFact(event, source, 'group.averageCellsKnown', group, skill.allHitItemAvgBoxIndex);
    if (averageFact) return averageFact;
  }
  if (skill.totalHitBoxIndex !== undefined) {
    const totalFact = buildGroupFact(event, source, 'group.totalCellsKnown', group, skill.totalHitBoxIndex);
    if (totalFact) return totalFact;
  }
  if (skill.allHitItemAvgBoxIndex !== undefined) {
    const averageFact = buildGroupFact(event, source, 'group.averageCellsKnown', group, skill.allHitItemAvgBoxIndex);
    if (averageFact) return averageFact;
  }

  return null;
}

function buildZeroCountTotalCellsFact(event, source, profile, sourceIds = getSourceIds(event?.skill)) {
  const skill = event?.skill ?? {};
  if (getBidKingHeroProfile(profile)?.id !== ETHAN_MONITOR_PROFILE.id) return null;
  const group = getAggregateGroup(skill, profile, sourceIds);
  if (group !== 'purple') return null;
  if (Number(skill.skillCid) !== 203) return null;
  if (skill.totalHitBoxIndex !== undefined && skill.totalHitBoxIndex !== null && skill.totalHitBoxIndex !== '') {
    return null;
  }
  if (skill.hitItemIndex === undefined || skill.hitItemIndex === null || skill.hitItemIndex === '') {
    return null;
  }

  const count = Number(skill.hitItemIndex);
  if (!Number.isFinite(count) || count !== 0) return null;

  return buildGroupFact(event, source, 'group.totalCellsKnown', group, 0);
}

function buildSourceIdAggregateFact(event, source, sourceIds, profile) {
  for (const id of sourceIds) {
    const fact = buildAggregateFactForSourceId(event, source, id, profile);
    if (fact) return fact;
  }
  return null;
}

function buildAggregateFactForSourceId(event, source, id, profile) {
  for (const config of [KNOWN_AGGREGATE_SKILLS.get(id), getIdAggregateConfig(id, profile)]) {
    if (!config) continue;
    const fact = buildGroupFact(event, source, config.factType, config.group, event.skill?.[config.valueKey]);
    if (fact) return fact;
  }
  return null;
}

function getIdAggregateConfig(id, profile) {
  const group = getAggregateGroupFromId(id, profile);
  if (!group) return null;
  if ((id >= 201 && id <= 205) || (id >= 100104 && id <= 100108)) {
    return { group, factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' };
  }
  if ((id >= 301 && id <= 305) || (id >= 100110 && id <= 100114)) {
    return { group, factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' };
  }
  return null;
}

function buildGroupFact(event, source, type, group, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  return {
    type,
    key: `${source.key}:${type}:${group}`,
    gameUid: event.gameUid ? String(event.gameUid) : null,
    group,
    value,
    source,
  };
}

function getSourceIds(skill) {
  return [skill?.itemCid, skill?.skillCid]
    .map(Number)
    .filter(Number.isFinite);
}

function getSkillName(skill) {
  return String(skill?.itemName ?? skill?.skillName ?? skill?.name ?? '').trim();
}

function getAggregateGroup(skill, profile = ETHAN_MONITOR_PROFILE, sourceIds = getSourceIds(skill)) {
  const name = getSkillName(skill);
  const nameGroup = getAggregateGroupFromName(name, profile);
  if (nameGroup) return nameGroup;

  for (const id of sourceIds) {
    const idGroup = getAggregateGroupFromId(id, profile);
    if (idGroup) return idGroup;
  }

  const qualities = Array.isArray(skill?.hitItemQuilityList)
    ? skill.hitItemQuilityList.map(Number).filter(Number.isFinite)
    : [];
  const groups = [...new Set(qualities.map((quality) => getQualityGroupFromId(quality, profile)).filter(Boolean))];
  return groups.length === 1 ? groups[0] : '';
}

function getAggregateGroupFromName(name, profile = ETHAN_MONITOR_PROFILE) {
  const normalized = String(name ?? '').trim();
  if (!normalized) return '';

  for (const [pattern, group] of getBidKingHeroProfile(profile).aggregateNameMatchers) {
    if (pattern.test(normalized)) return group;
  }

  return '';
}

function getAggregateGroupFromId(id, profile = ETHAN_MONITOR_PROFILE) {
  return getBidKingHeroProfile(profile).aggregateIdGroups[Number(id)] || '';
}

function isTotalCellsSkillName(name) {
  return name.includes('扫描');
}

function isAverageCellsSkillName(name) {
  return name.includes('均格');
}

function getQualityGroupFromName(name, profile = ETHAN_MONITOR_PROFILE) {
  return resolveQualityGroupFromName(profile, name);
}

function getQualityGroupFromId(id, profile = ETHAN_MONITOR_PROFILE) {
  return resolveQualityGroupFromId(profile, id);
}

function isCompleteRevealFact(event, group, profile = ETHAN_MONITOR_PROFILE) {
  if (!group) return false;

  const resolvedProfile = getBidKingHeroProfile(profile);
  const skill = event?.skill;
  const heroCid = Number(skill?.heroCid);
  const skillCid = Number(skill?.skillCid);

  return event?.group === 'hero' &&
    heroCid === 103 &&
    resolvedProfile.completeRevealGroups.has(group) &&
    resolvedProfile.completeRevealHeroSkillCids.includes(skillCid);
}

function getCompleteRevealGroup(event, profile = ETHAN_MONITOR_PROFILE) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  const skill = event?.skill;
  const heroCid = Number(skill?.heroCid);
  const skillCid = Number(skill?.skillCid);
  if (event?.group !== 'hero' || heroCid !== 103 || !Number.isFinite(skillCid)) return '';
  return resolvedProfile.completeRevealHeroSkillGroups?.[skillCid] || '';
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

module.exports = {
  buildBidKingMonitorFacts,
  getQualityGroupFromName,
  getQualityGroupFromId,
};
