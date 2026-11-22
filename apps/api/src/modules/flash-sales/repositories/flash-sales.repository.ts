import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { FlashSaleEntity } from '../entities/flash-sale.entity';
import type {
  FlashSaleCampaign,
  RescheduleCampaignParams,
} from '../interfaces/flash-sale.interface';

const INSERT_CAMPAIGN_IF_ABSENT_SQL = `
  INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (id) DO NOTHING`;
/**
 * remaining_stock = total_stock holds only with no orders, so the same statement drops the sale's
 * orders: one statement is one transaction, and a failure leaves the old sale whole.
 */
const RESCHEDULE_CAMPAIGN_SQL = `
  WITH dropped_orders AS (DELETE FROM orders WHERE flash_sale_id = $1)
  UPDATE flash_sales
  SET total_stock = $2, remaining_stock = $2, starts_at = $3, ends_at = $4, updated_at = NOW()
  WHERE id = $1`;

/** TypeORM returns `[rows, affectedCount]` for a raw UPDATE. */
type UpdateResult = [rows: unknown[], affectedCount: number];

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

  async insertIfAbsent(campaign: FlashSaleCampaign): Promise<void> {
    await this.flashSales.query(INSERT_CAMPAIGN_IF_ABSENT_SQL, [
      campaign.id,
      campaign.productId,
      campaign.totalStock,
      campaign.remainingStock,
      campaign.startsAt,
      campaign.endsAt,
    ]);
  }

  async reschedule(params: RescheduleCampaignParams): Promise<FlashSaleCampaign | null> {
    const [, affectedCount]: UpdateResult = await this.flashSales.query(RESCHEDULE_CAMPAIGN_SQL, [
      params.saleId,
      params.totalStock,
      new Date(params.startsAtMs),
      new Date(params.endsAtMs),
    ]);
    if (affectedCount === 0) return null;
    return this.findById(params.saleId);
  }
}
