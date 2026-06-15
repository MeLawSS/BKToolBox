const MONITOR_GRID_ROWS = 43;
const MONITOR_GRID_COLUMNS = 10;
const MONITOR_OUTLINE_SKILL_CID = 1002081;
const UNKNOWN_BLOCKER_SHAPES = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
  [3, 1], [3, 2], [3, 3], [3, 4], [3, 5],
  [4, 1], [4, 2], [4, 3], [4, 4],
  [5, 1], [5, 2], [5, 3], [5, 4],
  [6, 1], [6, 3],
].map(([width, height]) => ({ width, height, cells: width * height }))
  .sort((left, right) => left.cells - right.cells || left.width - right.width || left.height - right.height);

function createMonitorCells() {
  return Array.from({ length: MONITOR_GRID_ROWS * MONITOR_GRID_COLUMNS }, (_, index) => {
    const id = index + 1;
    return {
      id,
      row: Math.floor(index / MONITOR_GRID_COLUMNS) + 1,
      column: (index % MONITOR_GRID_COLUMNS) + 1,
    };
  });
}

function createEmptyMonitorGridState() {
  return {
    gameUid: null,
    outlines: [],
    qualityCells: [],
    minimumOccupied: null,
    revealedTypes: [],
    warnings: [],
    seenKeys: [],
  };
}

function parseSlotType(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9][1-9]$/.test(normalized)) return null;

  const width = Number(normalized[0]);
  const height = Number(normalized[1]);
  return {
    width,
    height,
    cells: width * height,
    label: `${width}x${height}`,
  };
}

function applyMonitorEventToGridState(currentState, event) {
  const nextGameUid = event?.gameUid ? String(event.gameUid) : null;
  const isNewGame = nextGameUid && nextGameUid !== currentState.gameUid;
  const skill = event?.skill;
  if (!skill) {
    return isNewGame ? { ...createEmptyMonitorGridState(), gameUid: nextGameUid } : currentState;
  }

  const hitBoxList = skill.hitBoxList ?? [];
  const hasOutlines = hitBoxList.some(hasBoxOutline);
  const hasQualityCells = hitBoxList.some(hasBoxQuality);
  const revealedTypes = getRevealedTypes(skill);
  if (!hasOutlines && !hasQualityCells && !revealedTypes.length) {
    return isNewGame ? { ...createEmptyMonitorGridState(), gameUid: nextGameUid } : currentState;
  }

  const baseState = isNewGame ? createEmptyMonitorGridState() : currentState;
  const eventKey = getScopedSeenKey(event?.gameUid, event?.key, 'event');
  const skillKey = getScopedSeenKey(event?.gameUid, skill?.uid, 'skill');
  const seenKeys = new Set(baseState.seenKeys ?? []);
  if ((eventKey && seenKeys.has(eventKey)) || (skillKey && seenKeys.has(skillKey))) {
    return currentState;
  }

  const nextState = {
    ...baseState,
    gameUid: event?.gameUid ?? baseState.gameUid,
    outlines: [...baseState.outlines],
    qualityCells: [...(baseState.qualityCells ?? [])],
    revealedTypes: revealedTypes.length
      ? revealedTypes
      : [...baseState.revealedTypes],
    warnings: [...baseState.warnings],
    seenKeys: [...baseState.seenKeys],
  };

  for (const key of [eventKey, skillKey]) {
    if (key && !nextState.seenKeys.includes(key)) nextState.seenKeys.push(key);
  }

  if (hasQualityCells) {
    nextState.qualityCells = mergeQualityCells(nextState.qualityCells, hitBoxList);
  }

  if (hasOutlines) {
    for (const box of hitBoxList) {
      const outline = buildOutline(box);
      if (outline.warning) {
        nextState.warnings.push(outline.warning);
      } else {
        nextState.outlines.push(outline);
      }
    }
  }

  nextState.outlines = mergeOutlines(nextState.outlines)
    .map((outline) => applyOutlineQuality(outline, nextState.qualityCells));
  nextState.minimumOccupied = inferMinimumOccupiedCells(nextState);
  return nextState;
}

function getScopedSeenKey(gameUid, value, fallbackPrefix) {
  if (!value) return '';
  return gameUid ? `${gameUid}:${value}` : `${fallbackPrefix}:${value}`;
}

function inferMinimumOccupiedCells({ outlines = [], columns = MONITOR_GRID_COLUMNS } = {}) {
  const validOutlines = outlines.filter((outline) => isValidOutline(outline, columns));
  if (!validOutlines.length) return null;
  const knownOutlineCellCount = countKnownOutlineCells(validOutlines);
  const defaultPrefixOccupiedCells = getDefaultPrefixOccupiedCells(validOutlines, columns);

  let best = null;
  for (const order of enumerateOutlineOrders(validOutlines)) {
    const simulation = withDefaultPrefixOccupiedCells(
      simulateKnownOutlineOrder(order, columns),
      order,
      defaultPrefixOccupiedCells,
      columns,
    );
    if (!simulation.valid) continue;
    if (!best || simulation.minTotalCells < best.minTotalCells) {
      best = simulation;
      if (best.minTotalCells === knownOutlineCellCount) break;
    }
  }

  return best ?? buildFallbackMinimum(validOutlines, defaultPrefixOccupiedCells);
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

function hasBoxQuality(box) {
  return getBoxQuality(box) !== null;
}

function hasBoxOutline(box) {
  return parseSlotType(box?.itemSlotType) !== null;
}

function getBoxQuality(box) {
  const qualityId = box?.itemQuility ?? box?.itemQuality ?? box?.qualityId;
  const qualityName = box?.itemQuilityName ?? box?.itemQualityName ?? box?.quality;
  if (qualityId === undefined && !qualityName) return null;
  return {
    qualityId,
    qualityName: qualityName ? String(qualityName) : String(qualityId),
  };
}

function mergeQualityCells(currentQualityCells, hitBoxList) {
  const byCell = new Map((currentQualityCells ?? []).map((entry) => [entry.cell, entry]));
  for (const box of hitBoxList) {
    const quality = getBoxQuality(box);
    if (!quality) continue;
    const protocolBoxId = normalizeProtocolBoxId(box?.boxId);
    if (protocolBoxId === null) continue;
    byCell.set(protocolBoxId + 1, {
      cell: protocolBoxId + 1,
      protocolBoxId,
      ...quality,
    });
  }
  return [...byCell.values()].sort((left, right) => left.cell - right.cell);
}

function applyOutlineQuality(outline, qualityCells) {
  const { qualityId: _qualityId, qualityName: _qualityName, qualityStatus: _qualityStatus, ...baseOutline } = outline;
  const hits = (qualityCells ?? []).filter((entry) => outline.cells.includes(entry.cell));
  if (!hits.length) return baseOutline;

  const qualities = [];
  const seen = new Set();
  for (const hit of hits) {
    const key = hit.qualityId !== undefined ? `id:${hit.qualityId}` : `name:${hit.qualityName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    qualities.push(hit);
  }

  if (qualities.length === 1) {
    return {
      ...baseOutline,
      qualityId: qualities[0].qualityId,
      qualityName: qualities[0].qualityName,
      qualityStatus: 'confirmed',
    };
  }

  return {
    ...baseOutline,
    qualityName: qualities.map((quality) => quality.qualityName).join('/'),
    qualityStatus: 'conflict',
  };
}

function normalizeProtocolBoxId(value) {
  const protocolBoxId = value === undefined || value === null ? 0 : Number(value);
  if (!Number.isInteger(protocolBoxId) || protocolBoxId < 0 || protocolBoxId >= MONITOR_GRID_ROWS * MONITOR_GRID_COLUMNS) {
    return null;
  }
  return protocolBoxId;
}

function buildOutline(box) {
  const protocolBoxId = box?.boxId === undefined || box?.boxId === null ? 0 : Number(box.boxId);
  const displayBoxId = protocolBoxId + 1;
  const size = parseSlotType(box?.itemSlotType);
  const price = parseBoxPrice(box);
  if (!Number.isInteger(protocolBoxId) || protocolBoxId < 0 || protocolBoxId >= MONITOR_GRID_ROWS * MONITOR_GRID_COLUMNS) {
    return { warning: `box ${box?.boxId ?? '-'} is outside the 43x10 board` };
  }
  if (!size) {
    return { warning: `box ${protocolBoxId} has unsupported slot ${box?.itemSlotType ?? '-'}` };
  }

  const startRow = Math.floor(protocolBoxId / MONITOR_GRID_COLUMNS) + 1;
  const startColumn = (protocolBoxId % MONITOR_GRID_COLUMNS) + 1;
  if (startColumn + size.width - 1 > MONITOR_GRID_COLUMNS || startRow + size.height - 1 > MONITOR_GRID_ROWS) {
    return { warning: `box ${protocolBoxId} ${size.label} exceeds the 43x10 board` };
  }

  const cells = [];
  for (let rowOffset = 0; rowOffset < size.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < size.width; columnOffset += 1) {
      cells.push(displayBoxId + rowOffset * MONITOR_GRID_COLUMNS + columnOffset);
    }
  }

  return {
    boxId: displayBoxId,
    protocolBoxId,
    row: startRow,
    column: startColumn,
    width: size.width,
    height: size.height,
    cells,
    label: size.label,
    price,
  };
}

function parseBoxPrice(box) {
  const rawPrice = box?.itemPrice ?? box?.price;
  const price = Number(rawPrice);
  return Number.isFinite(price) ? price : null;
}

function mergeOutlines(outlines) {
  const byFootprint = new Map();
  for (const outline of outlines) {
    const key = `${outline.boxId}:${outline.width}x${outline.height}`;
    const existing = byFootprint.get(key);
    byFootprint.set(key, existing ? mergeOutline(existing, outline) : outline);
  }
  return [...byFootprint.values()];
}

function mergeOutline(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    price: incoming.price ?? existing.price ?? null,
    qualityId: incoming.qualityId ?? existing.qualityId,
    qualityName: incoming.qualityName ?? existing.qualityName,
    qualityStatus: incoming.qualityStatus ?? existing.qualityStatus,
  };
}

function isValidOutline(outline, columns = MONITOR_GRID_COLUMNS) {
  return Number.isInteger(outline?.boxId)
    && Number.isInteger(outline?.width)
    && Number.isInteger(outline?.height)
    && outline.width > 0
    && outline.height > 0
    && canPlaceShapeAt(outline.boxId, outline.width, outline.height, columns);
}

function enumerateOutlineOrders(outlines, limit = 720) {
  if (outlines.length <= 1) return [outlines];
  const sorted = [...outlines].sort((left, right) => left.boxId - right.boxId || left.cells.length - right.cells.length);
  if (sorted.length >= 6) return [sorted];

  const orders = [];
  const used = new Set();
  const current = [];
  function visit() {
    if (orders.length >= limit) return;
    if (current.length === sorted.length) {
      orders.push([...current]);
      return;
    }
    for (let index = 0; index < sorted.length; index += 1) {
      if (used.has(index)) continue;
      used.add(index);
      current.push(sorted[index]);
      visit();
      current.pop();
      used.delete(index);
    }
  }
  visit();
  return orders;
}

function simulateKnownOutlineOrder(order, columns = MONITOR_GRID_COLUMNS) {
  const occupied = new Set();
  const unknownBlockingCells = new Set();
  for (const outline of order) {
    if (findFirstFit(occupied, outline.width, outline.height, outline.boxId, columns) !== outline.boxId) {
      const blockers = solveUnknownBlockers(occupied, outline, columns);
      if (!blockers) {
        return { valid: false };
      }
      for (const cell of blockers) {
        occupied.add(cell);
        unknownBlockingCells.add(cell);
      }
    }
    if (findFirstFit(occupied, outline.width, outline.height, outline.boxId, columns) !== outline.boxId) {
      return { valid: false };
    }
    for (const cell of getShapeCells(outline.boxId, outline.width, outline.height, columns)) {
      if (occupied.has(cell)) return { valid: false };
      occupied.add(cell);
    }
  }

  const rightMost = Math.max(...occupied);
  return {
    valid: true,
    minTotalCells: occupied.size,
    knownOutlineCellCount: order.reduce((sum, outline) => sum + outline.cells.length, 0),
    unknownBlockingCellCount: unknownBlockingCells.size,
    unknownBlockingCells: [...unknownBlockingCells].sort((left, right) => left - right),
    order: order.map((outline) => outline.boxId),
    holeCells: getHoleCells(occupied, rightMost),
  };
}

function buildFallbackMinimum(outlines, initialUnknownBlockingCells = []) {
  const occupied = new Set([
    ...initialUnknownBlockingCells,
    ...outlines.flatMap((outline) => outline.cells ?? []),
  ]);
  const unknownBlockingCells = [...initialUnknownBlockingCells].sort((left, right) => left - right);
  return {
    valid: false,
    minTotalCells: occupied.size,
    knownOutlineCellCount: countKnownOutlineCells(outlines),
    unknownBlockingCellCount: unknownBlockingCells.length || null,
    unknownBlockingCells,
    order: [],
    holeCells: [],
  };
}

function countKnownOutlineCells(outlines) {
  return new Set(outlines.flatMap((outline) => outline.cells ?? [])).size;
}

function withDefaultPrefixOccupiedCells(result, outlines, defaultPrefixOccupiedCells, columns = MONITOR_GRID_COLUMNS) {
  if (!result?.valid || defaultPrefixOccupiedCells.length === 0) return result;

  const knownCells = outlines.flatMap((outline) => outline.cells ?? []);
  const unknownBlockingCells = new Set([
    ...(result.unknownBlockingCells ?? []),
    ...defaultPrefixOccupiedCells,
  ]);
  const occupied = new Set([...knownCells, ...unknownBlockingCells]);
  const rightMost = Math.max(...occupied);
  return {
    ...result,
    minTotalCells: occupied.size,
    unknownBlockingCellCount: unknownBlockingCells.size,
    unknownBlockingCells: [...unknownBlockingCells].sort((left, right) => left - right),
    holeCells: getHoleCells(occupied, rightMost),
  };
}

function getDefaultPrefixOccupiedCells(outlines, columns = MONITOR_GRID_COLUMNS) {
  const anchorOutline = getBottomRightMostOutline(outlines, columns);
  if (!anchorOutline) return [];

  const prefixCellCount = Math.max(0, anchorOutline.boxId - 1);
  if (prefixCellCount === 0) return [];

  const knownCells = new Set(outlines.flatMap((outline) => outline.cells ?? []));
  return Array.from({ length: prefixCellCount }, (_, index) => index + 1)
    .filter((cell) => !knownCells.has(cell));
}

function getBottomRightMostOutline(outlines, columns = MONITOR_GRID_COLUMNS) {
  let best = null;
  for (const outline of outlines) {
    const bottomRightCell = outline.boxId + (outline.height - 1) * columns + outline.width - 1;
    if (!best
      || bottomRightCell > best.bottomRightCell
      || (bottomRightCell === best.bottomRightCell && outline.boxId > best.outline.boxId)) {
      best = { outline, bottomRightCell };
    }
  }
  return best?.outline ?? null;
}

function findFirstFit(occupied, width, height, maxStart, columns = MONITOR_GRID_COLUMNS) {
  for (let cell = 1; cell <= maxStart; cell += 1) {
    if (!canPlaceShapeAt(cell, width, height, columns)) continue;
    const cells = getShapeCells(cell, width, height, columns);
    if (cells.every((shapeCell) => !occupied.has(shapeCell))) return cell;
  }
  return null;
}

function solveUnknownBlockers(occupied, outline, columns = MONITOR_GRID_COLUMNS) {
  let needs = [];
  for (let cell = 1; cell < outline.boxId; cell += 1) {
    if (!canPlaceShapeAt(cell, outline.width, outline.height, columns)) continue;
    const cells = getShapeCells(cell, outline.width, outline.height, columns);
    if (cells.some((shapeCell) => occupied.has(shapeCell))) continue;
    const candidates = cells.filter((shapeCell) => !occupied.has(shapeCell) && !outline.cells.includes(shapeCell));
    if (!candidates.length) return null;
    needs.push(candidates);
  }

  const blockers = new Set();
  const blockerSet = new Set(occupied);
  while (needs.length) {
    const candidate = chooseBestBlocker(needs, blockerSet);
    if (candidate === null) return null;
    blockerSet.add(candidate);
    blockers.add(candidate);
    needs = needs.filter((cells) => !cells.includes(candidate));
  }
  return materializeUnknownBlockers(occupied, outline, blockers, columns);
}

function materializeUnknownBlockers(occupied, outline, requiredBlockers, columns = MONITOR_GRID_COLUMNS) {
  const blockerSet = new Set(occupied);
  const required = new Set(requiredBlockers);
  const added = new Set();
  let guard = 0;

  while ([...required].some((cell) => !blockerSet.has(cell))) {
    guard += 1;
    if (guard > MONITOR_GRID_ROWS * MONITOR_GRID_COLUMNS) return null;

    const placement = chooseBestUnknownBlockerPlacement(blockerSet, outline, required, columns);
    if (!placement) return null;

    for (const cell of placement.cells) {
      if (!blockerSet.has(cell)) {
        blockerSet.add(cell);
        added.add(cell);
      }
    }
  }

  return [...added].sort((left, right) => left - right);
}

function chooseBestUnknownBlockerPlacement(occupied, outline, required, columns = MONITOR_GRID_COLUMNS) {
  let best = null;
  for (const shape of UNKNOWN_BLOCKER_SHAPES) {
    const startCell = findFirstFit(occupied, shape.width, shape.height, MONITOR_GRID_ROWS * columns, columns);
    if (startCell === null || startCell >= outline.boxId) continue;

    const cells = getShapeCells(startCell, shape.width, shape.height, columns);
    if (cells.some((cell) => outline.cells.includes(cell))) continue;

    const addedCells = cells.filter((cell) => !occupied.has(cell));
    const coveredRequiredCount = addedCells.filter((cell) => required.has(cell)).length;
    if (!coveredRequiredCount) continue;

    const score = coveredRequiredCount / addedCells.length;
    const candidate = {
      startCell,
      cells,
      addedCells,
      coveredRequiredCount,
      score,
    };

    if (!best
      || candidate.score > best.score
      || (candidate.score === best.score && candidate.addedCells.length < best.addedCells.length)
      || (candidate.score === best.score && candidate.addedCells.length === best.addedCells.length && candidate.startCell < best.startCell)) {
      best = candidate;
    }
  }
  return best;
}

function chooseBestBlocker(needs, blockerSet) {
  const scores = new Map();
  for (const cells of needs) {
    for (const cell of cells) {
      if (blockerSet.has(cell)) continue;
      scores.set(cell, (scores.get(cell) ?? 0) + 1);
    }
  }
  let bestCell = null;
  let bestScore = -1;
  for (const [cell, score] of scores) {
    if (score > bestScore || (score === bestScore && (bestCell === null || cell < bestCell))) {
      bestCell = cell;
      bestScore = score;
    }
  }
  return bestCell;
}

function canPlaceShapeAt(cell, width, height, columns = MONITOR_GRID_COLUMNS) {
  const column = getCellColumn(cell, columns);
  const row = Math.floor((cell - 1) / columns) + 1;
  return column + width - 1 <= columns && row + height - 1 <= MONITOR_GRID_ROWS;
}

function getShapeCells(startCell, width, height, columns = MONITOR_GRID_COLUMNS) {
  const cells = [];
  for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
      cells.push(startCell + rowOffset * columns + columnOffset);
    }
  }
  return cells;
}

function getHoleCells(occupied, maxCell) {
  const holes = [];
  for (let cell = 1; cell <= maxCell; cell += 1) {
    if (!occupied.has(cell)) holes.push(cell);
  }
  return holes;
}

function getCellColumn(cell, columns = MONITOR_GRID_COLUMNS) {
  return ((cell - 1) % columns) + 1;
}

module.exports = {
  MONITOR_GRID_ROWS,
  MONITOR_GRID_COLUMNS,
  MONITOR_OUTLINE_SKILL_CID,
  createMonitorCells,
  createEmptyMonitorGridState,
  parseSlotType,
  applyMonitorEventToGridState,
  inferMinimumOccupiedCells,
};
