import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { useOrderConfirmationPoller } from '../hooks/use-order-confirmation-poller';
import type { PendingReservation } from '../types/orders.types';

const CLOCK_FAKES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
const USER_ID = 'alice';
const ORDER_ID = 'order-123';
const SESSION: PendingReservation = { userId: USER_ID, orderId: ORDER_ID };
const POLL_MS = 1_000;
const MAX_ATTEMPTS = 30;

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

    const { result } = renderHook(() => useOrderConfirmationPoller(SESSION));
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(0);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/orders/user/alice');
    expect(result.current).toEqual({ phase: 'polling' });
  });

  it('asks again 1000 ms after the previous answer and not before', async () => {
    const fetchStub = stubFetch(async () => reserved());
    renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);
    await advance(POLL_MS - 1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('does not rerender when repeated answers keep the order in the polling state', async () => {
    const fetchStub = stubFetch(async () => reserved());
    const render = vi.fn(() => useOrderConfirmationPoller(SESSION));
    renderHook(render);
    const initialRenders = render.mock.calls.length;
    await advance(POLL_MS * 3);
    expect(fetchStub).toHaveBeenCalledTimes(4);
    expect(render).toHaveBeenCalledTimes(initialRenders);
  });

  it('URL-encodes the user id in the request path', async () => {
    const fetchStub = stubFetch(async () => reserved());
    renderHook(() => useOrderConfirmationPoller({ userId: 'a+b@x.io', orderId: ORDER_ID }));
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
    const { result } = renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);
    await advance(POLL_MS);

    expect(result.current).toEqual({ phase: 'confirmed', orderId: ORDER_ID });
    await advance(4000);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports released and stops when the reservation disappears', async () => {
    const fetchStub = answerInOrder([reserved, () => orderStatusResponse('NONE', USER_ID)]);
    const { result } = renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);
    await advance(POLL_MS);

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
    const { result } = renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);

    await advance(POLL_MS);
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(POLL_MS);

    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ phase: 'confirmed', orderId: ORDER_ID });
  });
});

describe('useOrderConfirmationPoller attempt budget', () => {
  it.each([
    ['RESERVED answers', reserved],
    ['503 answers', unavailable],
  ])('times out on the 30th attempt of %s and sends no 31st', async (_label, answer) => {
    const fetchStub = stubFetch(async () => answer());
    const { result } = renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);

    await advance(POLL_MS * (MAX_ATTEMPTS - 2));
    expect(fetchStub).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(POLL_MS);

    expect(fetchStub).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result.current).toEqual({ phase: 'timed-out' });
    await advance(10_000);
    expect(fetchStub).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('confirms on the 30th attempt instead of timing out', async () => {
    const answers = Array.from({ length: MAX_ATTEMPTS - 1 }, () => reserved);
    answers.push(() => orderStatusResponse('CONFIRMED', USER_ID, ORDER_ID));
    answerInOrder(answers);
    const { result } = renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);

    await advance(POLL_MS * (MAX_ATTEMPTS - 1));

    expect(result.current).toEqual({ phase: 'confirmed', orderId: ORDER_ID });
  });
});

describe('useOrderConfirmationPoller lifecycle', () => {
  it('restarts from polling for a new user id and requests that user', async () => {
    const fetchStub = answerInOrder([
      () => orderStatusResponse('CONFIRMED', USER_ID, ORDER_ID),
      reserved,
    ]);
    const { result, rerender } = renderHook(
      ({ reservation }) => useOrderConfirmationPoller(reservation),
      { initialProps: { reservation: SESSION as PendingReservation | null } },
    );
    await advance(0);
    expect(result.current.phase).toBe('confirmed');

    rerender({ reservation: { userId: 'bob', orderId: ORDER_ID } });
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(0);

    expect(fetchStub.mock.calls.at(-1)?.[0]).toBe('/api/v1/orders/user/bob');
  });

  it('restarts polling for the same user when a new orderId arrives after released', async () => {
    const fetchStub = answerInOrder([
      () => orderStatusResponse('NONE', USER_ID),
      () => orderStatusResponse('CONFIRMED', USER_ID, 'order-2'),
    ]);
    const { result, rerender } = renderHook(
      ({ reservation }) => useOrderConfirmationPoller(reservation),
      { initialProps: { reservation: { userId: USER_ID, orderId: 'order-1' } } },
    );
    await advance(0);
    expect(result.current).toEqual({ phase: 'released' });

    rerender({ reservation: { userId: USER_ID, orderId: 'order-2' } });
    expect(result.current).toEqual({ phase: 'polling' });
    await advance(0);

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ phase: 'confirmed', orderId: 'order-2' });
  });

  it('returns to idle and stops when the reservation becomes null', async () => {
    const fetchStub = stubFetch(async () => reserved());
    const { result, rerender } = renderHook(
      ({ reservation }) => useOrderConfirmationPoller(reservation),
      { initialProps: { reservation: SESSION as PendingReservation | null } },
    );
    await advance(0);

    rerender({ reservation: null });
    await advance(4000);

    expect(result.current).toEqual({ phase: 'idle' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('stops requesting after unmount', async () => {
    const fetchStub = stubFetch(async () => reserved());
    const { unmount } = renderHook(() => useOrderConfirmationPoller(SESSION));
    await advance(0);

    unmount();
    await advance(4000);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
