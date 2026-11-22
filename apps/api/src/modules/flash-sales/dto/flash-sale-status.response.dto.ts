import type { FlashSaleStatus, SaleState } from '../interfaces/flash-sale.interface';

export class FlashSaleStatusResponseDto {
  saleId!: string;
  saleState!: SaleState;
  totalStock!: number;
  remainingStock!: number;
  startsAt!: string;
  endsAt!: string;
  serverTime!: string;

  static from(status: FlashSaleStatus): FlashSaleStatusResponseDto {
    return Object.assign(new FlashSaleStatusResponseDto(), {
      saleId: status.saleId,
      saleState: status.saleState,
      totalStock: status.totalStock,
      remainingStock: status.remainingStock,
      startsAt: new Date(status.startsAtMs).toISOString(),
      endsAt: new Date(status.endsAtMs).toISOString(),
      serverTime: new Date(status.serverTimeMs).toISOString(),
    });
  }
}
