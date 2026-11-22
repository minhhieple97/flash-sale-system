import type { FlashSaleSnapshot, SnapshotRead } from '../../sale-ledger';

export type SaleState = 'UPCOMING' | 'ACTIVE' | 'SOLD_OUT' | 'ENDED';

export interface FlashSaleStatus extends FlashSaleSnapshot {
  saleState: SaleState;
  serverTimeMs: number;
}

export interface FlashSaleCampaign {
  id: string;
  productId: string;
  totalStock: number;
  remainingStock: number;
  startsAt: Date;
  endsAt: Date;
}

export interface SaleWindowConfig {
  startsAtMs: number;
  endsAtMs: number;
  totalStock: number;
}

export type SaleWindowBounds = Pick<SaleWindowConfig, 'startsAtMs' | 'endsAtMs'>;

export interface ExplicitSaleConfig {
  window?: SaleWindowBounds;
  totalStock?: number;
}

/** Admin reset of the campaign row; `remaining_stock` is set back to `totalStock`. */
export interface RescheduleCampaignParams {
  saleId: string;
  totalStock: number;
  startsAtMs: number;
  endsAtMs: number;
}

export interface FlashSaleCacheEntry {
  snapshot: Promise<SnapshotRead>;
  expiresAtMs: number;
}
