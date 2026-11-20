export type SaleState = 'UPCOMING' | 'ACTIVE' | 'SOLD_OUT' | 'ENDED';

export interface FlashSaleSnapshot {
  saleId: string;
  productId: string;
  productName: string;
  salePriceCents: number;
  originalPriceCents: number;
  totalStock: number;
  remainingStock: number;
  startsAtMs: number;
  endsAtMs: number;
}

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

/** Admin reset of the campaign row; `remaining_stock` is set back to `totalStock`. */
export interface RescheduleCampaignParams {
  saleId: string;
  totalStock: number;
  startsAtMs: number;
  endsAtMs: number;
}

export interface FlashSaleCacheEntry {
  snapshot: Promise<FlashSaleSnapshot | null>;
  expiresAtMs: number;
}
