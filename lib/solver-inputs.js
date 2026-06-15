function toSolverItem(collectible) {
    return {
        name: collectible.name,
        price: collectible.price,
        w: collectible.size.width,
        h: collectible.size.height,
        cells: collectible.size.width * collectible.size.height,
    };
}

function prepareItems(collectibles, predicate, sortKey) {
    return collectibles
        .filter(predicate)
        .map(toSolverItem)
        .sort((a, b) => a[sortKey] - b[sortKey]);
}

function getValueRange(items, valueKey) {
    return {
        min: items[0][valueKey],
        max: items[items.length - 1][valueKey],
    };
}

function floorAverage(total, count) {
    return Math.floor(total / count * 100) / 100;
}

function findTotalForAveragePrice(avgPrice, count) {
    if (!Number.isFinite(avgPrice) || !Number.isInteger(count) || count <= 0) return null;

    const rawTotal = avgPrice * count;
    const roundedTotal = Math.round(rawTotal);
    const tolerance = count * 0.01;
    if (Math.abs(rawTotal - roundedTotal) <= tolerance + 1e-9) return roundedTotal;
    return null;
}

function getValidAveragePriceCounts(avgPrice, items, options = {}) {
    const maxCount = options.maxCount ?? 30;
    const valueKey = options.valueKey ?? 'price';
    const { min, max } = getValueRange(items, valueKey);
    const result = [];

    for (let count = 1; count <= maxCount; count++) {
        const total = findTotalForAveragePrice(avgPrice, count);
        if (total === null) continue;
        if (total < min * count || total > max * count) continue;
        result.push({ n: count, total });
    }

    return result;
}

function getValidTotalValueCounts(totalValue, items, options = {}) {
    const maxCount = options.maxCount ?? 30;
    const valueKey = options.valueKey ?? 'price';
    const { min, max } = getValueRange(items, valueKey);
    const result = [];

    for (let count = 1; count <= maxCount; count++) {
        if (totalValue < min * count || totalValue > max * count) continue;
        result.push({ n: count, total: totalValue });
    }

    return result;
}

function isValidRoundedAverage(total, count, toleranceRate = 0.01) {
    return Math.abs(total - Math.round(total)) <= count * toleranceRate;
}

function getValidRoundedAverageCounts(avgValue, items, options = {}) {
    const maxCount = options.maxCount ?? 30;
    const valueKey = options.valueKey ?? 'cells';
    const toleranceRate = options.toleranceRate ?? 0.01;
    const { min, max } = getValueRange(items, valueKey);
    const result = [];

    for (let count = 1; count <= maxCount; count++) {
        const raw = avgValue * count;
        const rounded = Math.round(raw);
        if (!isValidRoundedAverage(raw, count, toleranceRate)) continue;
        if (rounded < min * count || rounded > max * count) continue;
        result.push({ n: count, total: rounded });
    }

    return result;
}

module.exports = {
    floorAverage,
    findTotalForAveragePrice,
    getValidAveragePriceCounts,
    getValidRoundedAverageCounts,
    getValidTotalValueCounts,
    getValueRange,
    isValidRoundedAverage,
    prepareItems,
    toSolverItem,
};
