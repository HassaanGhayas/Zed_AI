import { describe, expect, it } from 'vitest';
import { quantizeSeconds } from './playerTime';

describe('quantizeSeconds', () => {
  it('quantizeSeconds floors finite values', () => {
    expect(quantizeSeconds(0)).toBe(0);
    expect(quantizeSeconds(0.999)).toBe(0);
    expect(quantizeSeconds(1)).toBe(1);
    expect(quantizeSeconds(12.7)).toBe(12);
    expect(quantizeSeconds(3599.99)).toBe(3599);
  });

  it('quantizeSeconds returns 0 for NaN, Infinity, negatives', () => {
    expect(quantizeSeconds(Number.NaN)).toBe(0);
    expect(quantizeSeconds(Number.POSITIVE_INFINITY)).toBe(0);
    expect(quantizeSeconds(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(quantizeSeconds(-0.5)).toBe(0);
    expect(quantizeSeconds(-10)).toBe(0);
  });
});
