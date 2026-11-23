import type { SaleState } from '@/modules/flash-sale';
import type { ConfirmationState } from '@/modules/orders';
import type { FeedbackCode, FeedbackPresentation } from '../types/checkout.types';

export const PURCHASE_PATH = '/checkout/purchase';
export const TEST_USER_ID_PREFIX = 'test-user-';
export const TEST_USER_ID_SUFFIX_LENGTH = 8;

export const PURCHASE_FEEDBACK = {
  RESERVED: { tone: 'info', title: 'Reserved! Confirming your order...' },
  ALREADY_PURCHASED: { tone: 'warning', title: 'Already purchased' },
  SOLD_OUT: { tone: 'danger', title: 'Sold out' },
  SALE_UPCOMING: { tone: 'info', title: 'Sale has not started' },
  SALE_ENDED: { tone: 'neutral', title: 'Sale has ended' },
  INVALID_USER_ID: { tone: 'warning', title: 'Invalid user ID' },
  TEMPORARY_FAILURE: { tone: 'danger', title: 'Temporarily unavailable' },
  RATE_LIMITED: {
    tone: 'warning',
    title: 'Too many requests. Please wait a moment and try again.',
  },
  CONFIRMED: { tone: 'success', title: 'Order confirmed' },
  RESERVATION_RELEASED: { tone: 'warning', title: 'Reservation released' },
  STILL_CONFIRMING: { tone: 'info', title: 'Still confirming' },
} as const satisfies Record<FeedbackCode, FeedbackPresentation>;

export const CONFIRMATION_FEEDBACK_KEY: Readonly<Record<ConfirmationState['phase'], FeedbackCode>> =
  {
    idle: 'RESERVED',
    polling: 'RESERVED',
    confirmed: 'CONFIRMED',
    released: 'RESERVATION_RELEASED',
    'timed-out': 'STILL_CONFIRMING',
  };

export const CONFIRMATION_NOTE: Readonly<Record<ConfirmationState['phase'], string | null>> = {
  idle: null,
  polling: null,
  confirmed: null,
  released: 'Your reservation was rolled back, so no order was placed. You can try again.',
  'timed-out': 'Check the order lookup below for the latest status.',
};

export const FALLBACK_PURCHASE_FEEDBACK: FeedbackPresentation = {
  tone: 'danger',
  title: 'Purchase failed',
};

export const BUY_DISABLED_REASON: Readonly<Record<SaleState, string | null>> = {
  ACTIVE: null,
  UPCOMING: 'The sale has not started yet.',
  SOLD_OUT: 'This sale is sold out.',
  ENDED: 'This sale has ended.',
};

export const BUY_DISABLED_REASON_UNKNOWN = 'Waiting for the sale status...';

export function feedbackFor(code: string): FeedbackPresentation {
  return Object.hasOwn(PURCHASE_FEEDBACK, code)
    ? PURCHASE_FEEDBACK[code as FeedbackCode]
    : FALLBACK_PURCHASE_FEEDBACK;
}
