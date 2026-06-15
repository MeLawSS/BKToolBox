import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildListingAdvice,
  calculateListingCosts,
} = require('./high-price-listing-advisor.js');

const feeConfig = {
  listingFeeRate: 0.05,
  tradeTaxRate: 0.04,
};

function ladder(observedAt, tiers) {
  return {
    observedAt,
    itemCid: 1083009,
    tiers,
  };
}

describe('buildListingAdvice', () => {
  it('recommends list_now when low tiers churn, supply thins, a stable gap exists, and net floor passes', () => {
    const advice = buildListingAdvice({
      item: {
        itemCid: 1083009,
        name: 'Plasma Cutter',
        quality: 'rare',
        basePrice: 4208,
      },
      ladders: [
        ladder('2026-06-01T00:00:00.000Z', [
          { price: 6100, count: 4 },
          { price: 6400, count: 3 },
          { price: 7800, count: 2 },
          { price: 8200, count: 1 },
        ]),
        ladder('2026-06-01T01:00:00.000Z', [
          { price: 6200, count: 2 },
          { price: 6400, count: 2 },
          { price: 7800, count: 2 },
          { price: 8300, count: 1 },
        ]),
        ladder('2026-06-01T02:00:00.000Z', [
          { price: 6400, count: 1 },
          { price: 7800, count: 2 },
          { price: 8400, count: 1 },
        ]),
      ],
      count: 1,
      feeConfig,
      now: new Date('2026-06-01T02:10:00.000Z'),
    });

    expect(advice.state).toBe('list_now');
    expect(advice.suggestedUnitPrice).toBe(7799);
    expect(advice.netRevenuePerItem).toBeGreaterThanOrEqual(4208);
    expect(advice.sellThrough24h).toBeGreaterThanOrEqual(0.55);
    expect(['low', 'medium', 'high']).toContain(advice.expirationRisk);
    expect(advice.reason).toContain('stable 6400->7800 gap');
  });

  it('returns do_not_list when fee and tax make net revenue below base price', () => {
    const advice = buildListingAdvice({
      item: { itemCid: 1083009, name: 'Plasma Cutter', quality: 'rare', basePrice: 9000 },
      ladders: [
        ladder('2026-06-01T00:00:00.000Z', [{ price: 7799, count: 1 }]),
        ladder('2026-06-01T01:00:00.000Z', [{ price: 7799, count: 1 }]),
        ladder('2026-06-01T02:00:00.000Z', [{ price: 7799, count: 1 }]),
      ],
      feeConfig,
    });

    expect(advice.state).toBe('do_not_list');
    expect(advice.blockers).toContain('net_revenue_below_base_price');
  });

  it('returns do_not_list when fee or tax config values are missing', () => {
    for (const invalidFeeConfig of [
      { listingFeeRate: null, tradeTaxRate: 0.04 },
      { listingFeeRate: '', tradeTaxRate: '' },
    ]) {
      const advice = buildListingAdvice({
        item: { itemCid: 1083009, name: 'Plasma Cutter', quality: 'rare', basePrice: 4208 },
        ladders: [
          ladder('2026-06-01T00:00:00.000Z', [{ price: 7799, count: 1 }]),
          ladder('2026-06-01T01:00:00.000Z', [{ price: 7799, count: 1 }]),
          ladder('2026-06-01T02:00:00.000Z', [{ price: 7799, count: 1 }]),
        ],
        feeConfig: invalidFeeConfig,
      });

      expect(advice.state).toBe('do_not_list');
      expect(advice.blockers).toContain('missing_fee_or_tax_config');
    }
  });

  it('returns wait with low confidence when only one snapshot exists', () => {
    const advice = buildListingAdvice({
      item: { itemCid: 1083009, name: 'Plasma Cutter', quality: 'rare', basePrice: 4208 },
      ladders: [
        ladder('2026-06-01T02:00:00.000Z', [
          { price: 6400, count: 1 },
          { price: 7800, count: 2 },
        ]),
      ],
      feeConfig,
    });

    expect(advice.state).toBe('wait');
    expect(advice.confidence).toBe('low');
    expect(advice.reason).toContain('need more ladder observations');
  });

  it('rejects stale high tiers as do_not_list', () => {
    const advice = buildListingAdvice({
      item: { itemCid: 1083009, name: 'Plasma Cutter', quality: 'rare', basePrice: 4208 },
      ladders: [
        ladder('2026-06-01T00:00:00.000Z', [
          { price: 6400, count: 1 },
          { price: 7800, count: 2 },
        ]),
        ladder('2026-06-01T01:00:00.000Z', [
          { price: 6400, count: 1 },
          { price: 7800, count: 2 },
        ]),
        ladder('2026-06-01T02:00:00.000Z', [
          { price: 6400, count: 1 },
          { price: 7800, count: 2 },
        ]),
        ladder('2026-06-01T03:00:00.000Z', [
          { price: 6400, count: 1 },
          { price: 7800, count: 2 },
        ]),
      ],
      feeConfig,
      now: new Date('2026-06-01T03:05:00.000Z'),
    });

    expect(advice.state).toBe('do_not_list');
    expect(advice.blockers).toContain('target_anchored_to_stale_high_tier');
  });

  it('does not reject when a stale highest tier is not the target gap upper price', () => {
    const advice = buildListingAdvice({
      item: { itemCid: 1083009, name: 'Plasma Cutter', quality: 'rare', basePrice: 80 },
      ladders: [
        ladder('2026-06-01T00:00:00.000Z', [
          { price: 100, count: 4 },
          { price: 1000, count: 1 },
          { price: 10000, count: 1 },
        ]),
        ladder('2026-06-01T01:00:00.000Z', [
          { price: 100, count: 3 },
          { price: 1000, count: 1 },
          { price: 10000, count: 1 },
        ]),
        ladder('2026-06-01T02:00:00.000Z', [
          { price: 100, count: 2 },
          { price: 1000, count: 1 },
          { price: 10000, count: 1 },
        ]),
        ladder('2026-06-01T03:00:00.000Z', [
          { price: 100, count: 1 },
          { price: 1000, count: 1 },
          { price: 10000, count: 1 },
        ]),
      ],
      feeConfig,
    });

    expect(advice.suggestedUnitPrice).toBe(999);
    expect(advice.state).toBe('list_now');
    expect(advice.blockers).not.toContain('target_anchored_to_stale_high_tier');
  });
});

describe('calculateListingCosts', () => {
  it('calculates per-item and total listing costs exactly', () => {
    expect(calculateListingCosts({
      unitPrice: 7799,
      count: 1,
      basePrice: 4208,
      feeConfig,
    })).toEqual({
      listingFeePerItem: 390,
      tradeTaxPerItem: 312,
      netRevenuePerItem: 7097,
      minimumSafePrice: 4625,
      listingFeeTotal: 390,
      tradeTaxTotal: 312,
      netRevenueTotal: 7097,
    });
  });
});
