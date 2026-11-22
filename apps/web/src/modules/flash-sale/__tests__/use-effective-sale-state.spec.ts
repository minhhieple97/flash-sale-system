import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_TICK_MS } from '../constants/flash-sale.constants';
import { useEffectiveSaleState } from '../hooks/use-effective-sale-state';
import type { FlashSaleStatus, SaleState } from '../types/flash-sale.types';
import { buildSale, HOUR_MS, isoAt, SERVER_NOW } from './flash-sale-fixtures';

const STARTS_IN_MS = 10_000;
const WINDOW_MS = 60_000;

function upcomingSale(): FlashSaleStatus {
  return buildSale({
    saleState: 'UPCOMING',
    startsAt: isoAt(STARTS_IN_MS),
    endsAt: isoAt(STARTS_IN_MS + WINDOW_MS),
  });
}

function activeSale(): FlashSaleStatus {
  return buildSale({
    saleState: 'ACTIVE',
    startsAt: isoAt(-WINDOW_MS),
    endsAt: isoAt(STARTS_IN_MS),
  });
}

function renderAtSkew(sale: FlashSaleStatus, skewMs: number): { current: () => SaleState | null } {
  vi.setSystemTime(SERVER_NOW + skewMs);
  const { result } = renderHook(() => useEffectiveSaleState(sale));
  return { current: () => result.current };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['ahead of the server by 1 hour', HOUR_MS],
  ['behind the server by 1 hour', -HOUR_MS],
])('useEffectiveSaleState with the client clock %s', (_name, skewMs) => {
  it('stays UPCOMING one millisecond before startsAt', () => {
    const state = renderAtSkew(upcomingSale(), skewMs);

    advance(STARTS_IN_MS - 1);

    expect(state.current()).toBe('UPCOMING');
  });

  it('turns ACTIVE at startsAt without a new poll', () => {
    const state = renderAtSkew(upcomingSale(), skewMs);

    advance(STARTS_IN_MS);

    expect(state.current()).toBe('ACTIVE');
  });

  it('stays ACTIVE at endsAt', () => {
    const state = renderAtSkew(activeSale(), skewMs);

    advance(STARTS_IN_MS);

    expect(state.current()).toBe('ACTIVE');
  });

  it('turns ENDED on the first tick after endsAt', () => {
    const state = renderAtSkew(activeSale(), skewMs);

    advance(STARTS_IN_MS + COUNTDOWN_TICK_MS);

    expect(state.current()).toBe('ENDED');
  });

  it('passes SOLD_OUT through even after endsAt', () => {
    const state = renderAtSkew(buildSale({ saleState: 'SOLD_OUT', endsAt: isoAt(1000) }), skewMs);

    advance(5000);

    expect(state.current()).toBe('SOLD_OUT');
  });
});

describe('useEffectiveSaleState without a sale', () => {
  it('returns null', () => {
    const { result } = renderHook(() => useEffectiveSaleState(null));

    expect(result.current).toBeNull();
  });

  it('stops ticking after unmount', () => {
    const { unmount } = renderHook(() => useEffectiveSaleState(upcomingSale()));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
