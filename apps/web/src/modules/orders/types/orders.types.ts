import type { AsyncState } from '@/shared/types/async-state.types';
import type { Tone } from '@/shared/types/tone.types';

export type OrderState = 'NONE' | 'RESERVED' | 'CONFIRMED';

export interface OrderStatus {
  userId: string;
  hasPurchased: boolean;
  status: OrderState;
  orderId: string | null;
}

export type ConfirmationState =
  | { phase: 'idle' }
  | { phase: 'polling' }
  | { phase: 'confirmed'; orderId: string }
  | { phase: 'released' }
  | { phase: 'timed-out' };

export interface OrderLookupHandle {
  state: AsyncState<OrderStatus>;
  lookup: (userId: string) => Promise<void>;
}

export interface LookupPresentation {
  tone: Tone;
  title: (userId: string) => string;
}
