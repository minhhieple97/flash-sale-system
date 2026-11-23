import type { ReactElement } from 'react';
import { type ConfirmationState, OrderReceiptBadge } from '@/modules/orders';
import { Alert } from '@/shared/components/Alert';
import {
  CONFIRMATION_FEEDBACK_KEY,
  CONFIRMATION_NOTE,
  feedbackFor,
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

function FeedbackContent({
  state,
  confirmation,
}: CheckoutFeedbackBannerProps): ReactElement | null {
  if (state.status === 'success') {
    return <ReservationFeedback reservation={state.data} confirmation={confirmation} />;
  }
  if (state.status === 'error') {
    const { tone, title } = feedbackFor(state.error.code);
    return (
      <Alert tone={tone} title={title}>
        {state.error.message}
      </Alert>
    );
  }
  return null;
}

export function CheckoutFeedbackBanner(props: CheckoutFeedbackBannerProps): ReactElement {
  const isVisible = props.state.status === 'success' || props.state.status === 'error';
  return (
    <div
      className={`mt-4 grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${isVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
    >
      <div className="min-h-0 overflow-hidden">
        <p aria-hidden={!isVisible} className="mb-2 text-xs font-medium text-slate-500">
          Latest result
        </p>
        <FeedbackContent {...props} />
      </div>
    </div>
  );
}
