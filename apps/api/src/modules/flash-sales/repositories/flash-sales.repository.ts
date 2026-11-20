import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { FlashSaleEntity } from '../entities/flash-sale.entity';
import type { FlashSaleCampaign } from '../interfaces/flash-sale.interface';

@Injectable()
export class FlashSalesRepository {
  constructor(
    @InjectRepository(FlashSaleEntity) private readonly flashSales: Repository<FlashSaleEntity>,
  ) {}

  async findById(saleId: string): Promise<FlashSaleCampaign | null> {
    const row = await this.flashSales.findOneBy({ id: saleId });
    if (!row) return null;
    return {
      id: row.id,
      productId: row.productId,
      totalStock: row.totalStock,
      remainingStock: row.remainingStock,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
  }
}
