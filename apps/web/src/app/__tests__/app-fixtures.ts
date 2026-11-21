import type { FlashSaleStatus } from '@/modules/flash-sale';

const SERVER_NOW = Date.parse('2026-03-01T12:00:00.000Z');
const HOUR_MS = 3_600_000;

export const ACTIVE_SALE: FlashSaleStatus = {
  saleId: 'sale-1',
  productId: 'product-1',
  productName: 'Titan X1 Carbon Wireless Mechanical Keyboard',
  salePriceCents: 12900,
  originalPriceCents: 24900,
  saleState: 'ACTIVE',
  totalStock: 100,
  remainingStock: 100,
  startsAt: new Date(SERVER_NOW - HOUR_MS).toISOString(),
  endsAt: new Date(SERVER_NOW + HOUR_MS).toISOString(),
  serverTime: new Date(SERVER_NOW).toISOString(),
};

export const ENDED_SALE: FlashSaleStatus = {
  ...ACTIVE_SALE,
  saleState: 'ENDED',
  serverTime: new Date(SERVER_NOW + 1000).toISOString(),
};
