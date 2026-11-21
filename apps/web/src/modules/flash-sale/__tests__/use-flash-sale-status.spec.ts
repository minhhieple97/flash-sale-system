import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '../../../test-support/fetch-stub';
import { STATUS_POLL_INTERVAL_MS } from '../constants/flash-sale.constants';
import { useFlashSaleStatus } from '../hooks/use-flash-sale-status';
import { buildSale, isoAt } from './flash-sale-fixtures';

const CLOCK_FAKES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;

function advance(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function unreachable(): Response {
  throw new TypeError('network down');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...CLOCK_FAKES] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useFlashSaleStatus', () => {
  it('starts empty, then fetches the current sale on mount', async () => {
    const sale = buildSale();
    const fetchStub = stubFetch(async () => jsonResponse(200, sale));

    const { result } = renderHook(() => useFlashSaleStatus());
    expect(result.current.sale).toBeNull();
    expect(result.current.error).toBeNull();
    await advance(0);

    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/flash-sales/current');
    expect(result.current.sale).toEqual(sale);
  });

  it('polls every 2000 ms and not before', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, buildSale()));
    renderHook(() => useFlashSaleStatus());
    await advance(0);

    await advance(1999);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await advance(1);

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('keeps the last sale and exposes the error when a poll fails', async () => {
    const sale = buildSale();
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(200, sale)
        : jsonResponse(503, { code: 'TEMPORARY_FAILURE', message: 'Try again soon.' });
    });
    const { result } = renderHook(() => useFlashSaleStatus());
    await advance(0);

    await advance(STATUS_POLL_INTERVAL_MS);

    expect(result.current.sale).toEqual(sale);
    expect(result.current.error).toEqual({ code: 'TEMPORARY_FAILURE', message: 'Try again soon.' });
  });

  it('clears the error on the next successful poll', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 2) return unreachable();
      return jsonResponse(
        200,
        buildSale({ remainingStock: 100 - calls, serverTime: isoAt(calls) }),
      );
    });
    const { result } = renderHook(() => useFlashSaleStatus());
    await advance(0);
    await advance(STATUS_POLL_INTERVAL_MS);
    expect(result.current.error?.code).toBe('NETWORK_ERROR');

    await advance(STATUS_POLL_INTERVAL_MS);

    expect(result.current.error).toBeNull();
    expect(result.current.sale?.remainingStock).toBe(97);
  });

  it('reports a failure with no sale when the first poll fails', async () => {
    stubFetch(async () =>
      jsonResponse(404, { code: 'NO_SALE', message: 'No sale is configured.' }),
    );

    const { result } = renderHook(() => useFlashSaleStatus());
    await advance(0);

    expect(result.current.sale).toBeNull();
    expect(result.current.error).toEqual({ code: 'NO_SALE', message: 'No sale is configured.' });
  });

  it('shows an applied snapshot immediately', async () => {
    stubFetch(async () => jsonResponse(200, buildSale()));
    const { result } = renderHook(() => useFlashSaleStatus());
    await advance(0);
    const reset = buildSale({ saleState: 'ENDED', serverTime: isoAt(500) });

    act(() => result.current.applySnapshot(reset));

    expect(result.current.sale).toEqual(reset);
  });

  it('ignores a polled snapshot older than the applied one', async () => {
    let resolveSlowPoll: (response: Response) => void = () => undefined;
    stubFetch(() => new Promise<Response>((resolve) => (resolveSlowPoll = resolve)));
    const { result } = renderHook(() => useFlashSaleStatus());
    await advance(0);
    const fresh = buildSale({ saleState: 'ENDED', serverTime: isoAt(5000) });
    act(() => result.current.applySnapshot(fresh));

    await act(async () => {
      resolveSlowPoll(
        jsonResponse(200, buildSale({ saleState: 'ACTIVE', serverTime: isoAt(1000) })),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.sale).toEqual(fresh);
  });

  it('accepts a newer polled snapshot over an applied one', async () => {
    let calls = 0;
    const newer = buildSale({ remainingStock: 5, serverTime: isoAt(9000) });
    stubFetch(async () => {
      calls += 1;
      return jsonResponse(200, calls === 1 ? buildSale({ serverTime: isoAt(0) }) : newer);
    });
    const { result } = renderHook(() => useFlashSaleStatus());
    await advance(0);
    act(() => result.current.applySnapshot(buildSale({ serverTime: isoAt(1000) })));

    await advance(STATUS_POLL_INTERVAL_MS);

    expect(result.current.sale).toEqual(newer);
  });

  it('stops polling after unmount', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, buildSale()));
    const { unmount } = renderHook(() => useFlashSaleStatus());
    await advance(0);

    unmount();
    await advance(STATUS_POLL_INTERVAL_MS * 3);

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
