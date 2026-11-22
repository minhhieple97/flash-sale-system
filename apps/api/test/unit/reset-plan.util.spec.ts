import { BadRequestException } from '@nestjs/common';
import { resolveResetPlan } from '../../src/modules/admin/utils/reset-plan.util';
import type { SaleWindowConfig } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';

const NOW_MS = 1_800_000_000_000;
const CONFIGURED: SaleWindowConfig = {
  startsAtMs: NOW_MS + 60_000,
  endsAtMs: NOW_MS + 360_000,
  totalStock: 7,
};
const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';

describe('resolveResetPlan', () => {
  it('falls back to the configured window for absent fields', () => {
    const plan = resolveResetPlan({}, NOW_MS, CONFIGURED);

    expect(plan).toEqual(CONFIGURED);
  });

  it('keeps the configured duration and stock when only an offset is given', () => {
    const plan = resolveResetPlan({ startsOffsetSeconds: 30 }, NOW_MS, CONFIGURED);

    expect(plan).toEqual({
      totalStock: 7,
      startsAtMs: NOW_MS + 30_000,
      endsAtMs: NOW_MS + 30_000 + 300_000,
    });
  });

  it('accepts absolute startsAt and endsAt', () => {
    const plan = resolveResetPlan(
      { startsAt: STARTS_AT, endsAt: ENDS_AT, totalStock: 3 },
      NOW_MS,
      CONFIGURED,
    );

    expect(plan).toEqual({
      totalStock: 3,
      startsAtMs: Date.parse(STARTS_AT),
      endsAtMs: Date.parse(ENDS_AT),
    });
  });

  it.each([
    { startsAt: STARTS_AT, startsOffsetSeconds: 5 },
    { endsAt: ENDS_AT, durationSeconds: 60 },
  ])('rejects absolute and relative fields together with 400 (%p)', (input) => {
    expect(() => resolveResetPlan(input, NOW_MS, CONFIGURED)).toThrow(BadRequestException);
  });

  it('rejects an endsAt that is not after startsAt with 400', () => {
    const input = { startsAt: ENDS_AT, endsAt: STARTS_AT };

    expect(() => resolveResetPlan(input, NOW_MS, CONFIGURED)).toThrow(BadRequestException);
  });

  it('resolves a negative offset into a window that already ended', () => {
    const plan = resolveResetPlan(
      { startsOffsetSeconds: -7200, durationSeconds: 3600 },
      NOW_MS,
      CONFIGURED,
    );

    expect(plan.startsAtMs).toBe(NOW_MS - 7_200_000);
    expect(plan.endsAtMs).toBe(NOW_MS - 3_600_000);
  });

  it('honors every explicit field', () => {
    const plan = resolveResetPlan(
      { totalStock: 5, startsOffsetSeconds: 30, durationSeconds: 90 },
      NOW_MS,
      CONFIGURED,
    );

    expect(plan).toEqual({
      totalStock: 5,
      startsAtMs: NOW_MS + 30_000,
      endsAtMs: NOW_MS + 120_000,
    });
  });

  it('keeps a stock of zero instead of falling back to the default', () => {
    const plan = resolveResetPlan({ totalStock: 0 }, NOW_MS, CONFIGURED);

    expect(plan.totalStock).toBe(0);
  });

  it('keeps an offset of zero as a window opening now', () => {
    const plan = resolveResetPlan(
      { startsOffsetSeconds: 0, durationSeconds: 60 },
      NOW_MS,
      CONFIGURED,
    );

    expect(plan.startsAtMs).toBe(NOW_MS);
    expect(plan.endsAtMs).toBe(NOW_MS + 60_000);
  });

  it('does not let a zero duration fall back to the default through a falsy check', () => {
    const plan = resolveResetPlan({ durationSeconds: 0 }, NOW_MS, CONFIGURED);

    expect(plan.endsAtMs).toBe(plan.startsAtMs);
  });
});
