/* @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeElsaAutoBidPrice,
  deriveElsaAutoBidKnownQualityKeys,
  elsaAutoBidKnownQualityKeys,
  elsaExpectedPrice,
  resolveElsaAutoBidMultiplier,
} from './elsaEstimateState.js';

describe('elsaEstimateState', () => {
  beforeEach(() => {
    elsaExpectedPrice.value = 0;
    elsaAutoBidKnownQualityKeys.value = [];
  });

  it('starts at 0', () => {
    expect(elsaExpectedPrice.value).toBe(0);
    expect(elsaAutoBidKnownQualityKeys.value).toEqual([]);
  });

  it('can be updated and read', () => {
    elsaExpectedPrice.value = 42000;
    elsaAutoBidKnownQualityKeys.value = ['green'];
    expect(elsaExpectedPrice.value).toBe(42000);
    expect(elsaAutoBidKnownQualityKeys.value).toEqual(['green']);
  });

  it('computes Elsa auto-bid multipliers with a floor of 1', () => {
    expect(resolveElsaAutoBidMultiplier([])).toBe(2);
    expect(resolveElsaAutoBidMultiplier(['white'])).toBe(2);
    expect(resolveElsaAutoBidMultiplier(['green'])).toBe(1.7);
    expect(resolveElsaAutoBidMultiplier(['green', 'blue'])).toBe(1);
    expect(resolveElsaAutoBidMultiplier(['green', 'blue', 'orange'])).toBe(1);
    expect(computeElsaAutoBidPrice(26619, ['green'])).toBe(45252);
  });

  it('treats orange as known when the estimate uses orange average cells or average price without total cells', () => {
    expect(deriveElsaAutoBidKnownQualityKeys({
      groups: {
        white: { cells: 2 },
        green: { cells: null },
        blue: { cells: null },
        purple: { cells: null },
        orange: { cells: null, avg: 4, priceAverage: null },
        red: { cells: null },
      },
    })).toEqual(['white', 'orange']);

    expect(deriveElsaAutoBidKnownQualityKeys({
      groups: {
        white: { cells: null },
        green: { cells: null },
        blue: { cells: null },
        purple: { cells: null },
        orange: { cells: null, avg: null, priceAverage: 25875 },
        red: { cells: null },
      },
    })).toEqual(['orange']);
  });
});
