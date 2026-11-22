import { useCallback, useRef, useState } from 'react';
import { submitPurchase } from '../api/checkout.api';
import type {
  PurchaseAttemptHandle,
  PurchaseAttemptSnapshot,
  PurchaseAttemptState,
  PurchaseResult,
} from '../types/checkout.types';

const IDLE: PurchaseAttemptState = { status: 'idle' };

export function usePurchaseAttempt(): PurchaseAttemptHandle {
  const [attempt, setAttempt] = useState<PurchaseAttemptSnapshot>({
    state: IDLE,
    lastResult: null,
  });
  const isInFlight = useRef(false);

  const submit = useCallback(async (userId: string): Promise<void> => {
    if (isInFlight.current) return;
    isInFlight.current = true;
    setAttempt((previous) => ({ ...previous, state: { status: 'loading' } }));
    const result = await submitPurchase(userId);
    isInFlight.current = false;
    const completed: PurchaseResult = result.ok
      ? { status: 'success', data: result.data }
      : { status: 'error', error: result.error };
    setAttempt({ state: completed, lastResult: completed });
  }, []);

  const reset = useCallback((): void => setAttempt({ state: IDLE, lastResult: null }), []);

  return { ...attempt, submit, reset };
}
