const DEFAULT_COUNT = 1;
function calculateListingCosts({ unitPrice, count = DEFAULT_COUNT, basePrice, feeConfig }) {
  const normalizedUnitPrice = normalizePositiveNumber(unitPrice);
  const normalizedCount = normalizePositiveInteger(count) || DEFAULT_COUNT;
  const normalizedBasePrice = normalizePositiveNumber(basePrice);
  const normalizedFeeConfig = normalizeFeeConfig(feeConfig);

  if (normalizedUnitPrice === null || normalizedBasePrice === null || !normalizedFeeConfig) {
    return null;
  }

  const { listingFeeRate, tradeTaxRate } = normalizedFeeConfig;
  const listingFeePerItem = Math.ceil(normalizedUnitPrice * listingFeeRate);
  const tradeTaxPerItem = Math.ceil(normalizedUnitPrice * tradeTaxRate);
  const netRevenuePerItem = normalizedUnitPrice - listingFeePerItem - tradeTaxPerItem;
  const minimumSafePrice = findMinimumSafePrice({
    basePrice: normalizedBasePrice,
    listingFeeRate,
    tradeTaxRate,
  });

  return {
    listingFeePerItem,
    tradeTaxPerItem,
    netRevenuePerItem,
    minimumSafePrice,
    listingFeeTotal: listingFeePerItem * normalizedCount,
    tradeTaxTotal: tradeTaxPerItem * normalizedCount,
    netRevenueTotal: netRevenuePerItem * normalizedCount,
  };
}

function buildListingAdvice({ item, ladders, count = DEFAULT_COUNT, feeConfig, now = new Date() }) {
  const normalizedItem = normalizeItem(item);
  const normalizedCount = normalizePositiveInteger(count) || DEFAULT_COUNT;
  const normalizedFeeConfig = normalizeFeeConfig(feeConfig);

  if (!normalizedItem) {
    return buildBlockedAdvice({
      item: null,
      count: normalizedCount,
      blocker: 'invalid_item',
      reason: 'invalid item metadata',
    });
  }

  if (!normalizedFeeConfig) {
    return buildBlockedAdvice({
      item: normalizedItem,
      count: normalizedCount,
      blocker: 'missing_fee_or_tax_config',
      reason: 'missing fee or tax config',
    });
  }

  const normalizedLadders = normalizeLadders(ladders);
  if (!normalizedLadders.length) {
    return buildBlockedAdvice({
      item: normalizedItem,
      count: normalizedCount,
      blocker: 'missing_ladder_history',
      reason: 'missing ladder history',
    });
  }

  const metrics = buildMetrics(normalizedLadders);
  const stableGap = findStableUpwardGap(normalizedLadders);
  const latestMinimumPrice = normalizedLadders.at(-1).tiers[0].price;
  const suggestedUnitPrice = stableGap ? stableGap.upperPrice - 1 : latestMinimumPrice;
  const costs = calculateListingCosts({
    unitPrice: suggestedUnitPrice,
    count: normalizedCount,
    basePrice: normalizedItem.basePrice,
    feeConfig: normalizedFeeConfig,
  });
  const blockers = [];
  const reasonParts = [];

  if (stableGap) {
    reasonParts.push(`stable ${stableGap.lowerPrice}->${stableGap.upperPrice} gap`);
  } else {
    reasonParts.push('anchored to latest minimum price');
  }

  if (costs.netRevenuePerItem < normalizedItem.basePrice) {
    blockers.push('net_revenue_below_base_price');
    reasonParts.push('net revenue below base price');
  }

  if (stableGap && metrics.staleHighTierPrice === stableGap.upperPrice) {
    blockers.push('target_anchored_to_stale_high_tier');
    reasonParts.push('target anchored to stale high tier');
  }

  const sellThrough24h = estimateSellThrough24h({ metrics, stableGap });
  const expirationRisk = estimateExpirationRisk({ metrics, stableGap });
  let state = 'wait';
  let confidence = normalizedLadders.length < 3 ? 'low' : 'medium';

  if (blockers.length) {
    state = 'do_not_list';
    confidence = 'high';
  } else if (normalizedLadders.length < 3) {
    reasonParts.push('need more ladder observations');
  } else if (
    sellThrough24h >= 0.55
    && stableGap
    && metrics.supplyTrend !== 'rising'
    && metrics.lowTierChurn !== 'slow'
  ) {
    state = 'list_now';
    confidence = 'medium';
    reasonParts.push(`${metrics.lowTierChurn} low tier churn`);
    reasonParts.push(`${metrics.supplyTrend} supply`);
  } else {
    reasonParts.push('market signal not strong enough');
  }

  return {
    item: normalizedItem,
    count: normalizedCount,
    state,
    suggestedUnitPrice,
    totalPrice: suggestedUnitPrice * normalizedCount,
    confidence,
    sellThrough24h,
    expirationRisk,
    reason: reasonParts.join('; '),
    blockers,
    metrics,
    ...costs,
  };
}

function buildBlockedAdvice({ item, count, blocker, reason }) {
  return {
    item,
    count,
    state: 'do_not_list',
    suggestedUnitPrice: null,
    totalPrice: null,
    confidence: 'high',
    sellThrough24h: 0,
    expirationRisk: 'high',
    reason,
    blockers: [blocker],
    metrics: null,
    listingFeePerItem: null,
    tradeTaxPerItem: null,
    netRevenuePerItem: null,
    minimumSafePrice: null,
    listingFeeTotal: null,
    tradeTaxTotal: null,
    netRevenueTotal: null,
  };
}

function normalizeItem(item) {
  const itemCid = normalizePositiveInteger(item?.itemCid ?? item?.cid);
  const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : null;
  const quality = typeof item?.quality === 'string' && item.quality.trim() ? item.quality.trim() : null;
  const basePrice = normalizePositiveNumber(item?.basePrice ?? item?.price);

  if (itemCid === null || !name || !quality || basePrice === null) return null;
  return { itemCid, name, quality, basePrice };
}

function normalizeFeeConfig(feeConfig) {
  if (!hasProvidedRate(feeConfig?.listingFeeRate) || !hasProvidedRate(feeConfig?.tradeTaxRate)) {
    return null;
  }

  const listingFeeRate = Number(feeConfig?.listingFeeRate);
  const tradeTaxRate = Number(feeConfig?.tradeTaxRate);
  if (
    !Number.isFinite(listingFeeRate)
    || !Number.isFinite(tradeTaxRate)
    || listingFeeRate < 0
    || tradeTaxRate < 0
    || listingFeeRate + tradeTaxRate >= 1
  ) {
    return null;
  }

  return { listingFeeRate, tradeTaxRate };
}

function hasProvidedRate(value) {
  return value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
}

function normalizeLadders(ladders) {
  if (!Array.isArray(ladders)) return [];

  return ladders
    .map((ladder) => {
      const observedAt = normalizeDate(ladder?.observedAt);
      const tiers = normalizeTiers(ladder?.tiers);
      if (!observedAt || !tiers.length) return null;
      return {
        observedAt: observedAt.toISOString(),
        observedTime: observedAt.getTime(),
        tiers,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.observedTime - b.observedTime);
}

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers)) return [];
  const normalized = [];

  for (const tier of tiers) {
    const price = normalizePositiveNumber(tier?.price);
    const count = normalizePositiveInteger(tier?.count);
    if (price === null || count === null) return [];
    normalized.push({ price, count });
  }

  return normalized.sort((a, b) => a.price - b.price);
}

function buildMetrics(ladders) {
  const minPrices = ladders.map((ladder) => ladder.tiers[0].price);
  const totals = ladders.map(totalListed);
  const latestTotalListed = totals.at(-1);
  const firstTotalListed = totals[0];
  const supplyTrend = classifySupplyTrend(firstTotalListed, latestTotalListed);
  const lowTierChurn = classifyLowTierChurn(ladders);
  const staleHighTier = findStaleHighTier(ladders);

  return {
    minPriceMedian: percentile(minPrices, 0.5),
    minPriceP80: percentile(minPrices, 0.8),
    minPriceP90: percentile(minPrices, 0.9),
    supplyTrend,
    lowTierChurn,
    staleHighTier: staleHighTier !== null,
    staleHighTierPrice: staleHighTier?.price ?? null,
    staleHighTierCount: staleHighTier?.count ?? null,
    latestTotalListed,
  };
}

function findStableUpwardGap(ladders) {
  const latest = ladders.at(-1);
  const requiredAppearances = Math.min(3, ladders.length);
  const latestGaps = findEligibleGaps(latest.tiers);

  for (const gap of latestGaps) {
    const appearances = ladders.filter((ladder) => hasAdjacentGap(ladder.tiers, gap)).length;
    if (appearances >= requiredAppearances) {
      return { ...gap, appearances };
    }
  }

  return null;
}

function findEligibleGaps(tiers) {
  const gaps = [];
  for (let index = 0; index < tiers.length - 1; index += 1) {
    const lowerPrice = tiers[index].price;
    const upperPrice = tiers[index + 1].price;
    const gapSize = upperPrice - lowerPrice;
    const minimumGap = Math.max(100, Math.ceil(lowerPrice * 0.12));
    if (gapSize >= minimumGap) {
      gaps.push({ lowerPrice, upperPrice, gapSize });
    }
  }
  return gaps;
}

function hasAdjacentGap(tiers, gap) {
  return tiers.some((tier, index) => {
    const next = tiers[index + 1];
    return next && tier.price === gap.lowerPrice && next.price === gap.upperPrice;
  });
}

function classifySupplyTrend(firstTotalListed, latestTotalListed) {
  if (latestTotalListed < firstTotalListed * 0.85) return 'falling';
  if (latestTotalListed > firstTotalListed * 1.15) return 'rising';
  return 'flat';
}

function classifyLowTierChurn(ladders) {
  if (ladders.length < 2) return 'medium';

  const first = ladders[0];
  const latest = ladders.at(-1);
  const firstLowSupply = countAtOrBelow(first.tiers, first.tiers[1]?.price ?? first.tiers[0].price);
  const latestLowSupply = countAtOrBelow(latest.tiers, first.tiers[1]?.price ?? first.tiers[0].price);

  if (latest.tiers[0].price > first.tiers[0].price || latestLowSupply <= firstLowSupply * 0.5) {
    return 'fast';
  }
  if (latestLowSupply < firstLowSupply) return 'medium';
  return 'slow';
}

function estimateSellThrough24h({ metrics, stableGap }) {
  let score = 0.35;
  if (stableGap) score += 0.18;
  if (metrics.supplyTrend === 'falling') score += 0.14;
  if (metrics.supplyTrend === 'rising') score -= 0.12;
  if (metrics.lowTierChurn === 'fast') score += 0.16;
  if (metrics.lowTierChurn === 'medium') score += 0.07;
  if (metrics.lowTierChurn === 'slow') score -= 0.1;
  if (metrics.staleHighTier) score -= 0.25;
  return clamp(round2(score), 0, 1);
}

function estimateExpirationRisk({ metrics, stableGap }) {
  let risk = 0.45;
  if (stableGap) risk -= 0.1;
  if (metrics.supplyTrend === 'rising') risk += 0.2;
  if (metrics.supplyTrend === 'falling') risk -= 0.1;
  if (metrics.lowTierChurn === 'slow') risk += 0.15;
  if (metrics.lowTierChurn === 'fast') risk -= 0.1;
  if (metrics.staleHighTier) risk += 0.3;
  return categorizeExpirationRisk(clamp(round2(risk), 0, 1));
}

function findMinimumSafePrice({ basePrice, listingFeeRate, tradeTaxRate }) {
  let price = Math.ceil(basePrice);
  while (price - Math.ceil(price * listingFeeRate) - Math.ceil(price * tradeTaxRate) < basePrice) {
    price += 1;
  }
  return price;
}

function findStaleHighTier(ladders) {
  if (ladders.length < 4) return null;

  const latestHighestTier = ladders.at(-1).tiers.at(-1);
  const unchangedAppearances = ladders.filter((ladder) => {
    const highestTier = ladder.tiers.at(-1);
    return highestTier.price === latestHighestTier.price && highestTier.count === latestHighestTier.count;
  }).length;

  if (unchangedAppearances < Math.ceil(ladders.length * 0.8)) return null;
  return latestHighestTier;
}

function categorizeExpirationRisk(risk) {
  if (risk >= 0.67) return 'high';
  if (risk >= 0.34) return 'medium';
  return 'low';
}

function totalListed(ladder) {
  return ladder.tiers.reduce((total, tier) => total + tier.count, 0);
}

function countAtOrBelow(tiers, price) {
  return tiers
    .filter((tier) => tier.price <= price)
    .reduce((total, tier) => total + tier.count, 0);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[clamp(index, 0, sorted.length - 1)];
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  buildListingAdvice,
  calculateListingCosts,
};
