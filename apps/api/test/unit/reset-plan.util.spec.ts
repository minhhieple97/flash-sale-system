import { resolveResetPlan } from '../../src/modules/admin/utils/reset-plan.util';
import { DEFAULT_CAMPAIGN_DURATION_MS } from '../../src/modules/flash-sales/constants/flash-sales.constants';

const NOW_MS = 1_800_000_000_000;

describe('resolveResetPlan', () => {
  it('applies every default for an empty input', () => {
    const plan = resolveResetPlan({}, NOW_MS);

    expect(plan).toEqual({
      totalStock: 100,
      startsAtMs: NOW_MS,
      endsAtMs: NOW_MS + DEFAULT_CAMPAIGN_DURATION_MS,
      productName: null,
    });
    expect(DEFAULT_CAMPAIGN_DURATION_MS).toBe(86_400_000);
  });

  it('resolves a negative offset into a window that already ended', () => {
    const plan = resolveResetPlan({ startsOffsetSeconds: -7200, durationSeconds: 3600 }, NOW_MS);

    expect(plan.startsAtMs).toBe(NOW_MS - 7_200_000);
    expect(plan.endsAtMs).toBe(NOW_MS - 3_600_000);
  });

  it('honors every explicit field', () => {
    const plan = resolveResetPlan(
      { totalStock: 5, startsOffsetSeconds: 30, durationSeconds: 90, productName: 'Demo' },
      NOW_MS,
    );

    expect(plan).toEqual({
      totalStock: 5,
      startsAtMs: NOW_MS + 30_000,
      endsAtMs: NOW_MS + 120_000,
      productName: 'Demo',
    });
  });

  it('keeps a stock of zero instead of falling back to the default', () => {
    const plan = resolveResetPlan({ totalStock: 0 }, NOW_MS);

    expect(plan.totalStock).toBe(0);
  });

  it('keeps an offset of zero as a window opening now', () => {
    const plan = resolveResetPlan({ startsOffsetSeconds: 0, durationSeconds: 60 }, NOW_MS);

    expect(plan.startsAtMs).toBe(NOW_MS);
    expect(plan.endsAtMs).toBe(NOW_MS + 60_000);
  });

  it('does not let a zero duration fall back to the default through a falsy check', () => {
    const plan = resolveResetPlan({ durationSeconds: 0 }, NOW_MS);

    expect(plan.endsAtMs).toBe(plan.startsAtMs);
  });
});
