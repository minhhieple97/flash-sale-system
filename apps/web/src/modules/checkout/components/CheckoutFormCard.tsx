import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { type FlashSaleStatus, type SaleState, useEffectiveSaleState } from '@/modules/flash-sale';
import {
  type ConfirmationState,
  type PendingReservation,
  useOrderConfirmationPoller,
} from '@/modules/orders';
import { Card } from '@/shared/components/Card';
import { UserIdField } from '@/shared/components/UserIdField';
import {
  BUY_DISABLED_REASON,
  BUY_DISABLED_REASON_UNKNOWN,
  TEST_USER_ID_PREFIX,
  TEST_USER_ID_SUFFIX_LENGTH,
} from '../constants/checkout.constants';
import { usePurchaseAttempt } from '../hooks/use-purchase-attempt';
import type { PurchaseAttemptState } from '../types/checkout.types';
import { CheckoutActions } from './CheckoutActions';
import { CheckoutFeedbackBanner } from './CheckoutFeedbackBanner';

interface CheckoutFormCardProps {
  sale: FlashSaleStatus | null;
  onPurchaseReserved?: () => void;
}

function generateTestUserId(): string {
  const hex = crypto.randomUUID().replaceAll('-', '');
  return TEST_USER_ID_PREFIX + hex.slice(0, TEST_USER_ID_SUFFIX_LENGTH);
}

function usePurchaseReservedNotifier(
  state: PurchaseAttemptState,
  phase: ConfirmationState['phase'],
  onPurchaseReserved?: () => void,
): void {
  const callbackRef = useRef(onPurchaseReserved);
  const handledStateRef = useRef<PurchaseAttemptState | null>(null);
  const previousPhaseRef = useRef<ConfirmationState['phase']>(phase);
  callbackRef.current = onPurchaseReserved;

  useEffect(() => {
    if (state === handledStateRef.current) return;
    handledStateRef.current = state;
    if (state.status === 'success') callbackRef.current?.();
  }, [state]);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previousPhase !== phase && (phase === 'confirmed' || phase === 'released')) {
      callbackRef.current?.();
    }
  }, [phase]);
}

function disabledReason(saleState: SaleState | null): string | null {
  return saleState === null ? BUY_DISABLED_REASON_UNKNOWN : BUY_DISABLED_REASON[saleState];
}

function toPendingReservation(state: PurchaseAttemptState): PendingReservation | null {
  if (state.status !== 'success') return null;
  return { userId: state.data.userId, orderId: state.data.orderId };
}

export function CheckoutFormCard({
  sale,
  onPurchaseReserved,
}: CheckoutFormCardProps): ReactElement {
  const [userId, setUserId] = useState('');
  const { state, lastResult, submit } = usePurchaseAttempt();
  const feedbackState = state.status === 'loading' && lastResult ? lastResult : state;
  const confirmation = useOrderConfirmationPoller(toPendingReservation(feedbackState));
  usePurchaseReservedNotifier(state, confirmation.phase, onPurchaseReserved);
  const saleState = useEffectiveSaleState(sale);
  const reason = disabledReason(saleState);
  const isSubmitting = state.status === 'loading';
  const canBuy = reason === null && !isSubmitting && userId.trim() !== '';

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (canBuy) void submit(userId);
  };

  return (
    <Card title="Checkout">
      <form onSubmit={handleSubmit} className="space-y-4">
        <UserIdField value={userId} onChange={setUserId} disabled={isSubmitting} />
        <CheckoutActions
          canBuy={canBuy}
          isSubmitting={isSubmitting}
          onRandomUser={() => setUserId(generateTestUserId())}
        />
        <span aria-live="polite" className="sr-only">
          {isSubmitting ? 'Processing your purchase' : ''}
        </span>
        {reason ? <p className="text-sm text-slate-600">{reason}</p> : null}
      </form>
      <CheckoutFeedbackBanner state={feedbackState} confirmation={confirmation} />
    </Card>
  );
}
