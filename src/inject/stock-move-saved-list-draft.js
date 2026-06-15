function normalizeItemCid(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const itemCid = Number(value);
    return Number.isSafeInteger(itemCid) && itemCid > 0 ? itemCid : null;
  }

  return null;
}

function normalizeCollectibleItemCid(item) {
  return normalizeItemCid(item?.itemCid) ?? normalizeItemCid(item?.cid);
}

export function addDraftCollectible(draftItems, collectible) {
  const next = Array.isArray(draftItems) ? [...draftItems] : [];
  const itemCid = normalizeCollectibleItemCid(collectible);

  if (!itemCid || next.some((item) => normalizeCollectibleItemCid(item) === itemCid)) {
    return next;
  }

  next.push(collectible);
  return next;
}

export function filterCollectiblesForDraftSearch(collectibles, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  if (!normalizedQuery) {
    return Array.isArray(collectibles) ? collectibles : [];
  }

  return (Array.isArray(collectibles) ? collectibles : []).filter((item) => {
    const haystack = [
      item?.name,
      item?.quality,
      item?.type,
      normalizeCollectibleItemCid(item),
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');

    return haystack.includes(normalizedQuery);
  });
}

export function buildSavedListSnapshotItems(draftItems) {
  return (Array.isArray(draftItems) ? draftItems : [])
    .map((item) => ({
      item,
      itemCid: normalizeCollectibleItemCid(item),
    }))
    .filter(({ itemCid }) => itemCid)
    .map(({ item, itemCid }) => ({
      itemCid,
      name: item?.name || '',
      quality: item?.quality || '',
      type: item?.type || '',
      sizeKey: item?.size?.key || '',
    }));
}
