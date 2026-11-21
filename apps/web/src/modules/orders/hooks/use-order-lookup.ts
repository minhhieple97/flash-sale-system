import { useCallback, useEffect, useRef, useState } from 'react';
import type { AsyncState } from '@/shared/types/async-state.types';
import { fetchOrderStatus } from '../api/orders.api';
import type { OrderLookupHandle, OrderStatus } from '../types/orders.types';

const IDLE: AsyncState<OrderStatus> = { status: 'idle' };

export function useOrderLookup(): OrderLookupHandle {
  const [state, setState] = useState<AsyncState<OrderStatus>>(IDLE);
  const latestRequest = useRef(0);

  useEffect(
    () => () => {
      latestRequest.current = -1;
    },
    [],
  );

  const lookup = useCallback(async (userId: string): Promise<void> => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setState({ status: 'loading' });
    const result = await fetchOrderStatus(userId);
    if (latestRequest.current !== requestId) return;
    setState(
      result.ok
        ? { status: 'success', data: result.data }
        : { status: 'error', error: result.error },
    );
  }, []);

  return { state, lookup };
}
