import type { FlashSaleStatus } from '../types/flash-sale.types';

export const SERVER_NOW = Date.parse('2026-03-01T12:00:00.000Z');
export const HOUR_MS = 3_600_000;

export function isoAt(offsetMs: number): string {
  return new Date(SERVER_NOW + offsetMs).toISOString();
}

export function buildSale(overrides: Partial<FlashSaleStatus> = {}): FlashSaleStatus {
  return {
    saleId: 'sale-1',
    saleState: 'ACTIVE',
    totalStock: 100,
    remainingStock: 37,
    startsAt: isoAt(-HOUR_MS),
    endsAt: isoAt(HOUR_MS),
    serverTime: isoAt(0),
    ...overrides,
  };
}
