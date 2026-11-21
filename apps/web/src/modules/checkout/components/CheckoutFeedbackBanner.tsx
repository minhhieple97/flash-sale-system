import type { ReactElement } from 'react';
import { type ConfirmationState, OrderReceiptBadge } from '@/modules/orders';
import { Alert } from '@/shared/components/Alert';
import {
  CONFIRMATION_FEEDBACK_KEY,
  CONFIRMATION_NOTE,
  FALLBACK_PURCHASE_FEEDBACK,
  PURCHASE_FEEDBACK,
} from '../constants/checkout.constants';
import type { PurchaseAttemptState, PurchaseReservation } from '../types/checkout.types';

interface CheckoutFeedbackBannerProps {
  state: PurchaseAttemptState;
  confirmation: ConfirmationState;
}

interface ReservationFeedbackProps {
  reservation: PurchaseReservation;
  confirmation: ConfirmationState;
}

function ReservationFeedback({
  reservation,
  confirmation,
}: ReservationFeedbackProps): ReactElement {
  const { tone, title } = PURCHASE_FEEDBACK[CONFIRMATION_FEEDBACK_KEY[confirmation.phase]];
  return (
    <Alert tone={tone} title={title}>
      {confirmation.phase === 'confirmed' ? (
        <OrderReceiptBadge orderId={confirmation.orderId} userId={reservation.userId} />
      ) : (
        <>
          <p>{CONFIRMATION_NOTE[confirmation.phase] ?? reservation.message}</p>
          <p className="mt-1 font-mono text-xs">Order {reservation.orderId}</p>
        </>
      )}
    </Alert>
  );
}

export function CheckoutFeedbackBanner({
  state,
  confirmation,
}: CheckoutFeedbackBannerProps): ReactElement | null {
  if (state.status === 'success') {
    return <ReservationFeedback reservation={state.data} confirmation={confirmation} />;
  }
  if (state.status === 'error') {
    const { tone, title } = PURCHASE_FEEDBACK[state.error.code] ?? FALLBACK_PURCHASE_FEEDBACK;
    return (
      <Alert tone={tone} title={title}>
        {state.error.message}
      </Alert>
    );
  }
  return null;
}
