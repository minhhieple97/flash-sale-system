import { describe, expect, it } from 'vitest';
import { discountPercent, formatCents } from '../utils/format-currency.util';

describe('formatCents', () => {
  it('formats whole dollars with two decimals', () => {
    expect(formatCents(12900)).toBe('$129.00');
  });

  it('formats zero as $0.00', () => {
    expect(formatCents(0)).toBe('$0.00');
  });

  it('keeps the cents and thousands separator', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
  });
});

describe('discountPercent', () => {
  it('rounds the percentage off the original price', () => {
    expect(discountPercent(24900, 12900)).toBe(48);
  });

  it('rounds a fractional percentage up from one half', () => {
    expect(discountPercent(300, 100)).toBe(67);
  });

  it('returns 0 when the sale price equals the original', () => {
    expect(discountPercent(1000, 1000)).toBe(0);
  });

  it('returns 0 when the sale price exceeds the original', () => {
    expect(discountPercent(1000, 1500)).toBe(0);
  });

  it('returns 0 when the original price is not positive', () => {
    expect(discountPercent(0, 0)).toBe(0);
  });
});
