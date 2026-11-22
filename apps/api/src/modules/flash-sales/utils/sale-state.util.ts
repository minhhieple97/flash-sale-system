import type { FlashSaleSnapshot } from '../../sale-ledger';
import type { SaleState } from '../interfaces/flash-sale.interface';

export function computeSaleState(snapshot: FlashSaleSnapshot, nowMs: number): SaleState {
  if (nowMs < snapshot.startsAtMs) return 'UPCOMING';
  if (nowMs > snapshot.endsAtMs) return 'ENDED';
  if (snapshot.remainingStock <= 0) return 'SOLD_OUT';
  return 'ACTIVE';
}
