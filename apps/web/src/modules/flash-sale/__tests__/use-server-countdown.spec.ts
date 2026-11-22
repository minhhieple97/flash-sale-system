import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_TICK_MS } from '../constants/flash-sale.constants';
import { useServerCountdown } from '../hooks/use-server-countdown';
import { HOUR_MS, isoAt, SERVER_NOW } from './flash-sale-fixtures';

const PARAMS = { targetAt: isoAt(15_000), serverTime: isoAt(0) };

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

describe('useServerCountdown', () => {
  it.each([
    ['ahead of the server by 1 hour', HOUR_MS],
    ['behind the server by 1 hour', -HOUR_MS],
    ['in sync with the server', 0],
  ])('reports the server-true remaining time when the client clock is %s', (_name, skewMs) => {
    vi.setSystemTime(SERVER_NOW + skewMs);

    const { result } = renderHook(() => useServerCountdown(PARAMS));

    expect(result.current).toBe(15_000);
  });

  it('counts down as time passes on a skewed client', () => {
    vi.setSystemTime(SERVER_NOW + HOUR_MS);
    const { result } = renderHook(() => useServerCountdown(PARAMS));

    advance(5000);

    expect(result.current).toBe(10_000);
  });

  it('refreshes every tick interval', () => {
    vi.setSystemTime(SERVER_NOW);
    const { result } = renderHook(() => useServerCountdown(PARAMS));

    advance(COUNTDOWN_TICK_MS);

    expect(result.current).toBe(15_000 - COUNTDOWN_TICK_MS);
  });

  it('clamps at zero once the target has passed', () => {
    vi.setSystemTime(SERVER_NOW);
    const { result } = renderHook(() => useServerCountdown(PARAMS));

    advance(20_000);

    expect(result.current).toBe(0);
  });

  it('re-syncs the clock offset when a new server time arrives', () => {
    vi.setSystemTime(SERVER_NOW);
    const { result, rerender } = renderHook((params) => useServerCountdown(params), {
      initialProps: PARAMS,
    });

    rerender({ ...PARAMS, serverTime: isoAt(5000) });

    expect(result.current).toBe(10_000);
  });

  it('stops ticking after unmount', () => {
    const { unmount } = renderHook(() => useServerCountdown(PARAMS));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
