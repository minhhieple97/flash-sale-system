import type { FlashSaleSnapshot } from '../../flash-sales/interfaces/flash-sale.interface';
import type { BuildSaleSnapshotParams } from '../interfaces/admin.interface';

/** Pure. Joins the product row and the campaign row into the Redis config/stock snapshot. */
export function buildSaleSnapshot({
  product,
  campaign,
  remainingStock,
}: BuildSaleSnapshotParams): FlashSaleSnapshot {
  return {
    saleId: campaign.id,
    productId: product.id,
    productName: product.name,
    salePriceCents: product.salePriceCents,
    originalPriceCents: product.originalPriceCents,
    totalStock: campaign.totalStock,
    remainingStock,
    startsAtMs: campaign.startsAt.getTime(),
    endsAtMs: campaign.endsAt.getTime(),
  };
}
