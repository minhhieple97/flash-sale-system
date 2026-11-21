import { useCallback, useRef, useState } from 'react';
import { submitPurchase } from '../api/checkout.api';
import type { PurchaseAttemptHandle, PurchaseAttemptState } from '../types/checkout.types';

const IDLE: PurchaseAttemptState = { status: 'idle' };

export function usePurchaseAttempt(): PurchaseAttemptHandle {
  const [state, setState] = useState<PurchaseAttemptState>(IDLE);
  const isInFlight = useRef(false);

  const submit = useCallback(async (userId: string): Promise<void> => {
    if (isInFlight.current) return;
    isInFlight.current = true;
    setState({ status: 'loading' });
    const result = await submitPurchase(userId);
    isInFlight.current = false;
    setState(
      result.ok
        ? { status: 'success', data: result.data }
        : { status: 'error', error: result.error },
    );
  }, []);

  const reset = useCallback((): void => setState(IDLE), []);

  return { state, submit, reset };
}
