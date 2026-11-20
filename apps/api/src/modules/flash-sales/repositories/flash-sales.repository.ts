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
const RESCHEDULE_CAMPAIGN_SQL = `
  UPDATE flash_sales
  SET total_stock = $2, remaining_stock = $2, starts_at = $3, ends_at = $4, updated_at = NOW()
  WHERE id = $1
  RETURNING id, product_id, total_stock, remaining_stock, starts_at, ends_at`;

interface CampaignRow {
  id: string;
  product_id: string;
  total_stock: number;
  remaining_stock: number;
  starts_at: Date;
  ends_at: Date;
}

/** TypeORM returns `[rows, affectedCount]` for UPDATE, even with RETURNING. */
type UpdateResult = [rows: CampaignRow[], affectedCount: number];

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
    const [rows]: UpdateResult = await this.flashSales.query(RESCHEDULE_CAMPAIGN_SQL, [
      params.saleId,
      params.totalStock,
      new Date(params.startsAtMs),
      new Date(params.endsAtMs),
    ]);
    const [row] = rows;
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      totalStock: row.total_stock,
      remainingStock: row.remaining_stock,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  }
}
