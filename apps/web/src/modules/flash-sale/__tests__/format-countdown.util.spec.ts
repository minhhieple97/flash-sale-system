import { describe, expect, it } from 'vitest';
import { formatCountdown } from '../utils/format-countdown.util';

describe('formatCountdown', () => {
  it.each([
    [0, '00:00:00'],
    [15_000, '00:00:15'],
    [14_001, '00:00:15'],
    [61_000, '00:01:01'],
    [3_661_000, '01:01:01'],
    [86_399_000, '23:59:59'],
    [93_784_000, '1d 02:03:04'],
    [-500, '00:00:00'],
  ])('formats %i ms as %s', (remainingMs, expected) => {
    const formatted = formatCountdown(remainingMs);

    expect(formatted).toBe(expected);
  });
});
