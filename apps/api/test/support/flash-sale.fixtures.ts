import type { FlashSaleSnapshot } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';

export const START_MS = 1_800_000_000_000;
export const END_MS = START_MS + 3_600_000;

export function buildSnapshot(overrides: Partial<FlashSaleSnapshot> = {}): FlashSaleSnapshot {
  return {
    saleId: 'sale-1',
    productId: 'product-1',
    productName: 'Phone',
    salePriceCents: 500,
    originalPriceCents: 1000,
    totalStock: 10,
    remainingStock: 5,
    startsAtMs: START_MS,
    endsAtMs: END_MS,
    ...overrides,
  };
}
