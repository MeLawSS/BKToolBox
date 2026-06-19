/* @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { elsaExpectedPrice } from './elsaEstimateState.js';

describe('elsaEstimateState', () => {
  beforeEach(() => {
    elsaExpectedPrice.value = 0;
  });

  it('starts at 0', () => {
    expect(elsaExpectedPrice.value).toBe(0);
  });

  it('can be updated and read', () => {
    elsaExpectedPrice.value = 42000;
    expect(elsaExpectedPrice.value).toBe(42000);
  });
});
