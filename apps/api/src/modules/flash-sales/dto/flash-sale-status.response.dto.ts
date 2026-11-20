import type { FlashSaleStatus, SaleState } from '../interfaces/flash-sale.interface';

export class FlashSaleStatusResponseDto {
  saleId!: string;
  productId!: string;
  productName!: string;
  salePriceCents!: number;
  originalPriceCents!: number;
  saleState!: SaleState;
  totalStock!: number;
  remainingStock!: number;
  startsAt!: string;
  endsAt!: string;
  serverTime!: string;

  static from(status: FlashSaleStatus): FlashSaleStatusResponseDto {
    return Object.assign(new FlashSaleStatusResponseDto(), {
      saleId: status.saleId,
      productId: status.productId,
      productName: status.productName,
      salePriceCents: status.salePriceCents,
      originalPriceCents: status.originalPriceCents,
      saleState: status.saleState,
      totalStock: status.totalStock,
      remainingStock: status.remainingStock,
      startsAt: new Date(status.startsAtMs).toISOString(),
      endsAt: new Date(status.endsAtMs).toISOString(),
      serverTime: new Date(status.serverTimeMs).toISOString(),
    });
  }
}
