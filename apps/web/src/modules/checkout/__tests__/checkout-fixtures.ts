import { jsonResponse } from '@/test-support/fetch-stub';

export const PURCHASE_URL = '/api/v1/checkout/purchase';
export const ORDER_ID = 'order-123';

export interface PurchaseOutcomeCase {
  status: number;
  code: string;
  message: string;
  title: string;
}

export const OUTCOME_CASES: readonly PurchaseOutcomeCase[] = [
  {
    status: 409,
    code: 'ALREADY_PURCHASED',
    message: 'This user already holds a unit from this sale',
    title: 'Already purchased',
  },
  { status: 410, code: 'SOLD_OUT', message: 'The flash sale is sold out', title: 'Sold out' },
  {
    status: 422,
    code: 'SALE_UPCOMING',
    message: 'The flash sale has not started yet',
    title: 'Sale has not started',
  },
  { status: 422, code: 'SALE_ENDED', message: 'The flash sale has ended', title: 'Sale has ended' },
];

export function reservedResponse(userId: string): Response {
  return jsonResponse(202, {
    code: 'RESERVED',
    orderId: ORDER_ID,
    userId,
    message: 'Your unit is reserved; the order is being confirmed',
  });
}

export function purchaseBody(call: unknown[]): unknown {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}
