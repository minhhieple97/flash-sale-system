import type { FlashSaleCampaign } from '../../flash-sales/interfaces/flash-sale.interface';
import type { Product } from '../../products/interfaces/product.interface';

/** Body of POST /api/v1/admin/flash-sales/reset. Every field is optional. */
export interface ResetFlashSaleInput {
  totalStock?: number;
  startsOffsetSeconds?: number;
  durationSeconds?: number;
  productName?: string;
}

/**
 * ResetFlashSaleInput with defaults applied and the window resolved against the clock.
 * `productName: null` keeps the stored product name.
 */
export interface ResetFlashSalePlan {
  totalStock: number;
  startsAtMs: number;
  endsAtMs: number;
  productName: string | null;
}

export interface BuildSaleSnapshotParams {
  product: Product;
  campaign: FlashSaleCampaign;
  remainingStock: number;
}
