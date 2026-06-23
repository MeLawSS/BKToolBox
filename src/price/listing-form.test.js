import { describe, expect, it } from 'vitest';
import { computeDefaultUnitPrice, computeTotal, validateListing } from './listing-form.js';

describe('computeDefaultUnitPrice', () => {
  it('uses the configured percentage and floors to an integer', () => {
    expect(computeDefaultUnitPrice(1600, 98)).toBe(1568);
    expect(computeDefaultUnitPrice(1600, 98.5)).toBe(1576);
    expect(computeDefaultUnitPrice(1600, 105)).toBe(1680);
  });

  it('floors the computed default at 1', () => {
    expect(computeDefaultUnitPrice(1, 98)).toBe(1);
    expect(computeDefaultUnitPrice(8, 1)).toBe(1);
  });

  it('returns null when there is no usable minPrice', () => {
    expect(computeDefaultUnitPrice(0, 98)).toBeNull();
    expect(computeDefaultUnitPrice(null, 98)).toBeNull();
    expect(computeDefaultUnitPrice(Number.NaN, 98)).toBeNull();
  });
});

describe('computeTotal', () => {
  it('multiplies integer count and unit price', () => {
    expect(computeTotal({ count: 3, unitPrice: 1590 })).toBe(4770);
  });

  it('returns null for non-positive or non-integer inputs', () => {
    expect(computeTotal({ count: 0, unitPrice: 1590 })).toBeNull();
    expect(computeTotal({ count: 2.5, unitPrice: 1590 })).toBeNull();
    expect(computeTotal({ count: 3, unitPrice: 0 })).toBeNull();
  });
});

describe('validateListing', () => {
  it('accepts an integer count within owned range and a positive integer price', () => {
    expect(validateListing({ count: 5, unitPrice: 1590, ownedCount: 12 }))
      .toEqual({ valid: true, errors: {} });
  });

  it('rejects a count above the owned amount', () => {
    const result = validateListing({ count: 13, unitPrice: 1590, ownedCount: 12 });
    expect(result.valid).toBe(false);
    expect(result.errors.count).toBe(true);
  });

  it('rejects a count below 1 and a unit price below 1', () => {
    expect(validateListing({ count: 0, unitPrice: 1590, ownedCount: 12 }).errors.count).toBe(true);
    expect(validateListing({ count: 5, unitPrice: 0, ownedCount: 12 }).errors.unitPrice).toBe(true);
  });

  it('rejects non-integer inputs', () => {
    expect(validateListing({ count: 2.5, unitPrice: 1590, ownedCount: 12 }).errors.count).toBe(true);
    expect(validateListing({ count: 5, unitPrice: 10.5, ownedCount: 12 }).errors.unitPrice).toBe(true);
  });
});
