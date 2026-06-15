function toOccupiedSet(items) {
  const occupied = new Set();

  for (const item of items || []) {
    for (const boxId of item.boxIds || []) {
      occupied.add(boxId);
    }
  }

  return occupied;
}

function getShapeOffsets(sourceContainer, item) {
  const width = Number(sourceContainer?.width);
  const baseSlot = Number(item?.pos);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(baseSlot)) return [];

  const baseX = baseSlot % width;
  const baseY = Math.floor(baseSlot / width);

  return (item?.boxIds || []).map((boxId) => ({
    dx: (boxId % width) - baseX,
    dy: Math.floor(boxId / width) - baseY,
  }));
}

export function sortMovableItems(items) {
  return [...items].sort((left, right) => {
    if (right.boxCount !== left.boxCount) {
      return right.boxCount - left.boxCount;
    }

    return left.pos - right.pos;
  });
}

export function findFirstPlacement(targetContainer, sourceContainer, item) {
  const width = Number(targetContainer?.width);
  if (!Number.isInteger(width) || width <= 0) return null;

  const offsets = getShapeOffsets(sourceContainer, item);
  if (!offsets.length) return null;

  const occupied = toOccupiedSet(targetContainer?.items);
  const cellsByCoord = new Map((targetContainer?.cells || []).map((cell) => [
    `${cell.x},${cell.y}`,
    cell.boxId,
  ]));
  const anchors = [...(targetContainer?.cells || [])].sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y;
    return left.x - right.x;
  });

  for (const anchor of anchors) {
    const boxIds = [];
    let fits = true;

    for (const offset of offsets) {
      const boxId = cellsByCoord.get(`${anchor.x + offset.dx},${anchor.y + offset.dy}`);
      if (!Number.isInteger(boxId) || occupied.has(boxId)) {
        fits = false;
        break;
      }
      boxIds.push(boxId);
    }

    if (fits) {
      return {
        newSlot: anchor.boxId,
        boxIds,
      };
    }
  }

  return null;
}

export function buildMoveArgs({ sourceItem, targetStockId, placement }) {
  return {
    oldStockId: sourceItem.stockId,
    oldSlot: sourceItem.pos,
    newStockId: targetStockId,
    newSlot: placement.newSlot,
    isRotate: sourceItem.rotate,
  };
}
