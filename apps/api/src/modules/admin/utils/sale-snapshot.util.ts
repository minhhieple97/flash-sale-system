import type { FlashSaleCampaign } from '../../flash-sales/interfaces/flash-sale.interface';
import type { FlashSaleSnapshot } from '../../sale-ledger';

export function buildSaleSnapshot(
  campaign: FlashSaleCampaign,
  remainingStock: number,
): FlashSaleSnapshot {
  return {
    saleId: campaign.id,
    totalStock: campaign.totalStock,
    remainingStock,
    startsAtMs: campaign.startsAt.getTime(),
    endsAtMs: campaign.endsAt.getTime(),
  };
}
