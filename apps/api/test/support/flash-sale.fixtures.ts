import type { FlashSaleSnapshot } from '../../src/modules/sale-ledger';

export const START_MS = 1_800_000_000_000;
export const END_MS = START_MS + 3_600_000;

export function buildSnapshot(overrides: Partial<FlashSaleSnapshot> = {}): FlashSaleSnapshot {
  return {
    saleId: 'sale-1',
    totalStock: 10,
    remainingStock: 5,
    startsAtMs: START_MS,
    endsAtMs: END_MS,
    ...overrides,
  };
}
