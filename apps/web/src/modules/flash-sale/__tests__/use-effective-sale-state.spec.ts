import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffectiveSaleState } from '../hooks/use-effective-sale-state';
import type { FlashSaleStatus, SaleState } from '../types/flash-sale.types';
import { buildSale, HOUR_MS, isoAt, SERVER_NOW } from './flash-sale-fixtures';

const STARTS_IN_MS = 10_000;
const WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;

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

  it('turns ENDED immediately at 1 ms after endsAt without idle polling', () => {
    const state = renderAtSkew(activeSale(), skewMs);

    advance(STARTS_IN_MS + 1);

    expect(state.current()).toBe('ENDED');
  });

  it('transitions UPCOMING -> SOLD_OUT at startsAt when remainingStock is zero', () => {
    const sale = buildSale({
      saleState: 'UPCOMING',
      remainingStock: 0,
      startsAt: isoAt(STARTS_IN_MS),
      endsAt: isoAt(STARTS_IN_MS + WINDOW_MS),
    });
    const state = renderAtSkew(sale, skewMs);

    advance(STARTS_IN_MS - 1);
    expect(state.current()).toBe('UPCOMING');
    advance(1);
    expect(state.current()).toBe('SOLD_OUT');
  });

  it('transitions SOLD_OUT -> ENDED past endsAt', () => {
    const sale = buildSale({
      saleState: 'SOLD_OUT',
      remainingStock: 0,
      endsAt: isoAt(1000),
    });
    const state = renderAtSkew(sale, skewMs);

    advance(1000);
    expect(state.current()).toBe('SOLD_OUT');
    advance(1);
    expect(state.current()).toBe('ENDED');
  });
});

describe('useEffectiveSaleState boundary scheduling', () => {
  it('does not rerender on a 250ms interval while waiting for the next boundary', () => {
    vi.setSystemTime(SERVER_NOW);
    const sale = upcomingSale();
    const render = vi.fn(() => useEffectiveSaleState(sale));
    renderHook(render);
    const initialRenders = render.mock.calls.length;

    advance(STARTS_IN_MS - 1);

    expect(render).toHaveBeenCalledTimes(initialRenders);
  });

  it('clamps and re-arms cleanly when the boundary is longer than 2^31 - 1 ms', () => {
    vi.setSystemTime(SERVER_NOW);
    const sale = buildSale({
      saleState: 'UPCOMING',
      startsAt: isoAt(30 * DAY_MS),
      endsAt: isoAt(31 * DAY_MS),
    });
    const { result } = renderHook(() => useEffectiveSaleState(sale));

    advance(25 * DAY_MS);
    expect(result.current).toBe('UPCOMING');
    advance(5 * DAY_MS);
    expect(result.current).toBe('ACTIVE');
  });

  it('schedules no timer once the sale has already ended', () => {
    vi.setSystemTime(SERVER_NOW);
    const sale = buildSale({
      saleState: 'ENDED',
      startsAt: isoAt(-2 * HOUR_MS),
      endsAt: isoAt(-HOUR_MS),
    });

    const { result } = renderHook(() => useEffectiveSaleState(sale));

    expect(result.current).toBe('ENDED');
    expect(vi.getTimerCount()).toBe(0);
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
