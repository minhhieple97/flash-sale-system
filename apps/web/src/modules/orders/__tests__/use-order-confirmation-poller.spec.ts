import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { useOrderConfirmationPoller } from '../hooks/use-order-confirmation-poller';

const CLOCK_FAKES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
const USER_ID = 'alice';
const ORDER_ID = 'order-123';

function advance(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function reserved(): Response {
  return orderStatusResponse('RESERVED', USER_ID, ORDER_ID);
}

function unavailable(): Response {
  return jsonResponse(503, { code: 'TEMPORARY_FAILURE', message: 'Try again soon.' });
}

function answerInOrder(answers: Array<() => Response>): ReturnType<typeof stubFetch> {
  let call = 0;
  return stubFetch(async () => {
    const answer = answers[Math.min(call, answers.length - 1)] as () => Response;
    call += 1;
    return answer();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...CLOCK_FAKES] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useOrderConfirmationPoller start and cadence', () => {
  it('stays idle and sends no request without a user id', async () => {
    const fetchStub = stubFetch(async () => reserved());

    const { result } = renderHook(() => useOrderConfirmationPoller(null));
    await advance(5000);

    expect(result.current).toEqual({ phase: 'idle' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('is polling at once and sends the first request immediately', async () => {
    const fetchStub = stubFetch(async () => reserved());

    const { result } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(0);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/orders/user/alice');
    expect(result.current).toEqual({ phase: 'polling' });
  });

  it('asks again 400 ms after the previous answer and not before', async () => {
    const fetchStub = stubFetch(async () => reserved());
    renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);

    await advance(399);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await advance(1);

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('URL-encodes the user id in the request path', async () => {
    const fetchStub = stubFetch(async () => reserved());

    renderHook(() => useOrderConfirmationPoller('a+b@x.io'));
    await advance(0);

    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/orders/user/a%2Bb%40x.io');
  });
});

describe('useOrderConfirmationPoller terminal answers', () => {
  it('reports confirmed with the order id and sends nothing further', async () => {
    const fetchStub = answerInOrder([
      reserved,
      () => orderStatusResponse('CONFIRMED', USER_ID, ORDER_ID),
    ]);
    const { result } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);
    await advance(400);

    expect(result.current).toEqual({ phase: 'confirmed', orderId: ORDER_ID });
    const requestsAtConfirmation = fetchStub.mock.calls.length;
    await advance(4000);

    expect(fetchStub).toHaveBeenCalledTimes(requestsAtConfirmation);
    expect(requestsAtConfirmation).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports released and stops when the reservation disappears', async () => {
    const fetchStub = answerInOrder([reserved, () => orderStatusResponse('NONE', USER_ID)]);
    const { result } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);
    await advance(400);

    expect(result.current).toEqual({ phase: 'released' });
    await advance(4000);

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('network down'))],
    ['a 503 answer', () => Promise.resolve(unavailable())],
  ])('keeps polling through %s and recovers on the next answer', async (_label, failure) => {
    let call = 0;
    const fetchStub = stubFetch(async () => {
      call += 1;
      if (call === 2) return failure();
      return call === 1 ? reserved() : orderStatusResponse('CONFIRMED', USER_ID, ORDER_ID);
    });
    const { result } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);

    await advance(400);
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(400);

    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ phase: 'confirmed', orderId: ORDER_ID });
  });
});

describe('useOrderConfirmationPoller attempt budget', () => {
  it.each([
    ['RESERVED answers', reserved],
    ['503 answers', unavailable],
  ])('times out on the 75th attempt of %s and sends no 76th', async (_label, answer) => {
    const fetchStub = stubFetch(async () => answer());
    const { result } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);

    await advance(400 * 73);
    expect(fetchStub).toHaveBeenCalledTimes(74);
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(400);

    expect(fetchStub).toHaveBeenCalledTimes(75);
    expect(result.current).toEqual({ phase: 'timed-out' });
    await advance(10_000);
    expect(fetchStub).toHaveBeenCalledTimes(75);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('confirms on the 75th attempt instead of timing out', async () => {
    const answers = Array.from({ length: 74 }, () => reserved);
    answers.push(() => orderStatusResponse('CONFIRMED', USER_ID, ORDER_ID));
    answerInOrder(answers);
    const { result } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);

    await advance(400 * 74);

    expect(result.current).toEqual({ phase: 'confirmed', orderId: ORDER_ID });
  });
});

describe('useOrderConfirmationPoller lifecycle', () => {
  it('restarts from polling for a new user id and requests that user', async () => {
    const fetchStub = answerInOrder([
      () => orderStatusResponse('CONFIRMED', USER_ID, ORDER_ID),
      reserved,
    ]);
    const { result, rerender } = renderHook(({ id }) => useOrderConfirmationPoller(id), {
      initialProps: { id: USER_ID as string | null },
    });
    await advance(0);
    expect(result.current.phase).toBe('confirmed');

    rerender({ id: 'bob' });
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(0);

    expect(fetchStub.mock.calls.at(-1)?.[0]).toBe('/api/v1/orders/user/bob');
  });

  it('returns to idle and stops when the user id becomes null', async () => {
    const fetchStub = stubFetch(async () => reserved());
    const { result, rerender } = renderHook(({ id }) => useOrderConfirmationPoller(id), {
      initialProps: { id: USER_ID as string | null },
    });
    await advance(0);

    rerender({ id: null });
    await advance(4000);

    expect(result.current).toEqual({ phase: 'idle' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('stops requesting after unmount', async () => {
    const fetchStub = stubFetch(async () => reserved());
    const { unmount } = renderHook(() => useOrderConfirmationPoller(USER_ID));
    await advance(0);

    unmount();
    await advance(4000);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
