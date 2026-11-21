import type { AsyncState } from '@/shared/types/async-state.types';
import type { Tone } from '@/shared/types/tone.types';

export interface PurchaseReservation {
  orderId: string;
  userId: string;
  message: string;
}

export interface PurchaseReservedBody extends PurchaseReservation {
  code: 'RESERVED';
}

export type PurchaseAttemptState = AsyncState<PurchaseReservation>;

export interface PurchaseAttemptHandle {
  state: PurchaseAttemptState;
  submit: (userId: string) => Promise<void>;
  reset: () => void;
}

export interface FeedbackPresentation {
  tone: Tone;
  title: string;
}
