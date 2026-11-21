import type { FlashSaleStatus } from '@/modules/flash-sale';

export const RESET_URL = '/api/v1/admin/flash-sales/reset';
const SERVER_NOW = Date.parse('2026-03-01T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function isoAt(offsetMs: number): string {
  return new Date(SERVER_NOW + offsetMs).toISOString();
}

export function buildSale(overrides: Partial<FlashSaleStatus> = {}): FlashSaleStatus {
  return {
    saleId: 'sale-1',
    productId: 'product-1',
    productName: 'Titan X1 Carbon Wireless Mechanical Keyboard',
    salePriceCents: 12900,
    originalPriceCents: 24900,
    saleState: 'ACTIVE',
    totalStock: 100,
    remainingStock: 100,
    startsAt: isoAt(-HOUR_MS),
    endsAt: isoAt(HOUR_MS),
    serverTime: isoAt(0),
    ...overrides,
  };
}
