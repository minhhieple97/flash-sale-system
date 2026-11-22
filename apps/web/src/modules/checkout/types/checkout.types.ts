import type { AsyncState } from '@/shared/types/async-state.types';
import type { Tone } from '@/shared/types/tone.types';

export type PurchaseOutcomeCode =
  | 'RESERVED'
  | 'ALREADY_PURCHASED'
  | 'SOLD_OUT'
  | 'SALE_UPCOMING'
  | 'SALE_ENDED'
  | 'INVALID_USER_ID'
  | 'TEMPORARY_FAILURE';

export type ConfirmationFeedbackCode = 'CONFIRMED' | 'RESERVATION_RELEASED' | 'STILL_CONFIRMING';

export type FeedbackCode = PurchaseOutcomeCode | ConfirmationFeedbackCode;

export interface PurchaseReservation {
  orderId: string;
  userId: string;
  message: string;
}

export interface PurchaseReservedBody extends PurchaseReservation {
  code: 'RESERVED';
}

export type PurchaseAttemptState = AsyncState<PurchaseReservation>;
export type PurchaseResult = Extract<PurchaseAttemptState, { status: 'success' | 'error' }>;

export interface PurchaseAttemptSnapshot {
  state: PurchaseAttemptState;
  lastResult: PurchaseResult | null;
}

export interface PurchaseAttemptHandle extends PurchaseAttemptSnapshot {
  submit: (userId: string) => Promise<void>;
  reset: () => void;
}

export interface FeedbackPresentation {
  tone: Tone;
  title: string;
}
