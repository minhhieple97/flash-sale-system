import type { LookupPresentation, OrderState } from '../types/orders.types';

export const CONFIRMATION_POLL_INTERVAL_MS = 1_000;
export const CONFIRMATION_POLL_MAX_ATTEMPTS = 30;

export function orderStatusPath(userId: string): string {
  return `/orders/user/${encodeURIComponent(userId)}`;
}

export const LOOKUP_PRESENTATION: Readonly<Record<OrderState, LookupPresentation>> = {
  CONFIRMED: { tone: 'success', title: () => 'Order confirmed' },
  RESERVED: { tone: 'info', title: () => 'Reserved, awaiting confirmation' },
  NONE: { tone: 'neutral', title: (userId) => `No order found for ${userId}` },
};

export const LOOKUP_FAILED_TITLE = 'Lookup failed';
