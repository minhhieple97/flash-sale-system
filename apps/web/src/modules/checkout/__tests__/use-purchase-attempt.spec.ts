import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { usePurchaseAttempt } from '../hooks/use-purchase-attempt';
import {
  ORDER_ID,
  OUTCOME_CASES,
  PURCHASE_URL,
  purchaseBody,
  reservedResponse,
} from './checkout-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePurchaseAttempt', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => usePurchaseAttempt());

    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('is loading while the POST is pending', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const { result } = renderHook(() => usePurchaseAttempt());

    act(() => {
      void result.current.submit('alice');
    });

    expect(result.current.state).toEqual({ status: 'loading' });
  });

  it('POSTs the raw user id to the purchase endpoint', async () => {
    const fetchStub = stubFetch(async () => reservedResponse('alice'));
    const { result } = renderHook(() => usePurchaseAttempt());

    await act(() => result.current.submit('  Alice '));

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe(PURCHASE_URL);
    expect((fetchStub.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(purchaseBody(fetchStub.mock.calls[0])).toEqual({ userId: '  Alice ' });
  });

  it('succeeds with the order id and the server-normalized user id on 202', async () => {
    stubFetch(async () => reservedResponse('alice'));
    const { result } = renderHook(() => usePurchaseAttempt());

    await act(() => result.current.submit('Alice'));

    expect(result.current.state).toMatchObject({
      status: 'success',
      data: { orderId: ORDER_ID, userId: 'alice' },
    });
  });

  it.each(OUTCOME_CASES)('exposes $code from a $status as an error', async (outcome) => {
    stubFetch(async () =>
      jsonResponse(outcome.status, { code: outcome.code, message: outcome.message }),
    );
    const { result } = renderHook(() => usePurchaseAttempt());

    await act(() => result.current.submit('alice'));

    expect(result.current.state).toEqual({
      status: 'error',
      error: { code: outcome.code, message: outcome.message },
    });
  });

  it.each([
    [400, 'INVALID_USER_ID'],
    [503, 'TEMPORARY_FAILURE'],
  ])('exposes a %i as the %s error', async (status, code) => {
    stubFetch(async () => jsonResponse(status, { code, message: 'nope' }));
    const { result } = renderHook(() => usePurchaseAttempt());

    await act(() => result.current.submit('alice'));

    expect(result.current.state).toMatchObject({ status: 'error', error: { code } });
  });

  it('reports a network failure as NETWORK_ERROR', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = renderHook(() => usePurchaseAttempt());

    await act(() => result.current.submit('alice'));

    expect(result.current.state).toMatchObject({
      status: 'error',
      error: { code: 'NETWORK_ERROR' },
    });
  });

  it('sends no second request while one is loading', async () => {
    const fetchStub = stubFetch(() => new Promise<Response>(() => undefined));
    const { result } = renderHook(() => usePurchaseAttempt());
    act(() => {
      void result.current.submit('alice');
    });

    await act(() => result.current.submit('alice'));

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('returns to idle on reset', async () => {
    stubFetch(async () => reservedResponse('alice'));
    const { result } = renderHook(() => usePurchaseAttempt());
    await act(() => result.current.submit('alice'));
    await waitFor(() => expect(result.current.state.status).toBe('success'));

    act(() => result.current.reset());

    expect(result.current.state).toEqual({ status: 'idle' });
  });
});
