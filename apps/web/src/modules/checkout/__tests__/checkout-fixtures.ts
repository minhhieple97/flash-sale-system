import type { FlashSaleStatus, SaleState } from '@/modules/flash-sale';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';

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
  {
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Too many requests; please retry shortly',
    title: 'Too many requests. Please wait a moment and try again.',
  },
];

export function reservedResponse(userId: string, orderId = ORDER_ID): Response {
  return jsonResponse(202, {
    code: 'RESERVED',
    orderId,
    userId,
    message: 'Your unit is reserved; the order is being confirmed',
  });
}

export function purchaseBody(call: unknown[]): unknown {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}

export const SALE_STARTS_AT = '2026-03-01T12:00:10.000Z';
export const SALE_SERVER_TIME = '2026-03-01T12:00:00.000Z';
const HOUR_MS = 3_600_000;
const TIME_BY_STATE: Record<
  SaleState,
  Pick<FlashSaleStatus, 'startsAt' | 'endsAt' | 'remainingStock'>
> = {
  UPCOMING: { startsAt: SALE_STARTS_AT, endsAt: '2026-03-01T13:00:00.000Z', remainingStock: 37 },
  ACTIVE: {
    startsAt: new Date(Date.parse(SALE_SERVER_TIME) - HOUR_MS).toISOString(),
    endsAt: new Date(Date.parse(SALE_SERVER_TIME) + HOUR_MS).toISOString(),
    remainingStock: 37,
  },
  SOLD_OUT: {
    startsAt: new Date(Date.parse(SALE_SERVER_TIME) - HOUR_MS).toISOString(),
    endsAt: new Date(Date.parse(SALE_SERVER_TIME) + HOUR_MS).toISOString(),
    remainingStock: 0,
  },
  ENDED: {
    startsAt: new Date(Date.parse(SALE_SERVER_TIME) - 2 * HOUR_MS).toISOString(),
    endsAt: new Date(Date.parse(SALE_SERVER_TIME) - HOUR_MS).toISOString(),
    remainingStock: 37,
  },
};

export function saleWithState(
  saleState: SaleState,
  overrides: Partial<FlashSaleStatus> = {},
): FlashSaleStatus {
  return {
    saleId: 'sale-1',
    saleState,
    totalStock: 100,
    ...TIME_BY_STATE[saleState],
    serverTime: SALE_SERVER_TIME,
    ...overrides,
  };
}

export function stubCheckoutFlow(
  terminalStatus: 'CONFIRMED' | 'NONE',
): ReturnType<typeof stubFetch> {
  let orderCalls = 0;
  return stubFetch(async (url) => {
    if (url === PURCHASE_URL) return reservedResponse('alice');
    orderCalls += 1;
    return orderStatusResponse(orderCalls < 2 ? 'RESERVED' : terminalStatus, 'alice', ORDER_ID);
  });
}
