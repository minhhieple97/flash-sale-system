import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import type { ReservationRef } from '../../sale-ledger';
import { CONFIRMED_ORDER_STATUS } from '../constants/orders.constants';
import { OrderPersistenceRejectedError } from '../errors/order-persistence-rejected.error';
import type {
  ConfirmedBatchPage,
  ListConfirmedBatchParams,
  PersistOrderResult,
} from '../interfaces/order.interface';

const INSERT_ORDER_SQL = `
  INSERT INTO orders (id, flash_sale_id, product_id, user_id, status, created_at)
  SELECT $1, fs.id, fs.product_id, $2, $3, NOW()
  FROM flash_sales fs WHERE fs.id = $4
  ON CONFLICT (flash_sale_id, user_id) DO NOTHING
  RETURNING id`;
const DECREMENT_STOCK_SQL = `
  UPDATE flash_sales SET remaining_stock = remaining_stock - 1, updated_at = NOW()
  WHERE id = $1 AND remaining_stock > 0`;
const FIND_ORDER_ID_SQL = 'SELECT id FROM orders WHERE flash_sale_id = $1 AND user_id = $2';
const HAS_CONFIRMED_SQL = 'SELECT 1 FROM orders WHERE flash_sale_id = $1 AND status = $2 LIMIT 1';
const LIST_CONFIRMED_FIRST_SQL = `
  SELECT id, user_id, created_at::text AS created_at FROM orders
  WHERE flash_sale_id = $1 AND status = $2
  ORDER BY orders.created_at, orders.id LIMIT $3`;
const LIST_CONFIRMED_AFTER_SQL = `
  SELECT id, user_id, created_at::text AS created_at FROM orders
  WHERE flash_sale_id = $1 AND status = $2 AND (created_at, id) > ($3::timestamptz, $4)
  ORDER BY orders.created_at, orders.id LIMIT $5`;

interface IdRow {
  id: string;
}

interface ConfirmedBatchRow extends IdRow {
  user_id: string;
  created_at: string;
}

/** TypeORM returns `[rows, affectedCount]` for UPDATE, unlike INSERT ... RETURNING and SELECT. */
type MutationResult = [rows: unknown[], affectedCount: number];

/** PostgreSQL side of orders. Ids read back are cast to NormalizedUserId: only this system writes them. */
@Injectable()
export class OrdersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async persistConfirmedOrder(ref: ReservationRef): Promise<PersistOrderResult> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: IdRow[] = await manager.query(INSERT_ORDER_SQL, [
        ref.orderId,
        ref.userId,
        CONFIRMED_ORDER_STATUS,
        ref.saleId,
      ]);
      if (inserted.length > 0) {
        await this.decrementStock(manager, ref);
        return { outcome: 'INSERTED', orderId: ref.orderId };
      }
      return this.existingOrder(manager, ref);
    });
  }

  async findConfirmedOrderId(saleId: string, userId: NormalizedUserId): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.query(FIND_ORDER_ID_SQL, [saleId, userId]);
    return rows[0]?.id ?? null;
  }

  async hasConfirmedOrders(saleId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(HAS_CONFIRMED_SQL, [
      saleId,
      CONFIRMED_ORDER_STATUS,
    ]);
    return rows.length > 0;
  }

  async listConfirmedBatch(params: ListConfirmedBatchParams): Promise<ConfirmedBatchPage> {
    const { saleId, limit, cursor } = params;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`Batch limit must be a positive integer, got ${limit}`);
    }
    const fetchLimit = limit + 1;
    const rows: ConfirmedBatchRow[] = cursor
      ? await this.dataSource.query(LIST_CONFIRMED_AFTER_SQL, [
          saleId,
          CONFIRMED_ORDER_STATUS,
          cursor.createdAt,
          cursor.id,
          fetchLimit,
        ])
      : await this.dataSource.query(LIST_CONFIRMED_FIRST_SQL, [
          saleId,
          CONFIRMED_ORDER_STATUS,
          fetchLimit,
        ]);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      entries: pageRows.map((row) => ({
        userId: row.user_id as NormalizedUserId,
        orderId: row.id,
      })),
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    };
  }

  private async decrementStock(manager: EntityManager, ref: ReservationRef): Promise<void> {
    const [, updated]: MutationResult = await manager.query(DECREMENT_STOCK_SQL, [ref.saleId]);
    if (updated === 0) {
      throw new OrderPersistenceRejectedError('STOCK_INVARIANT_VIOLATION', ref.orderId);
    }
  }

  private async existingOrder(
    manager: EntityManager,
    ref: ReservationRef,
  ): Promise<PersistOrderResult> {
    const rows: IdRow[] = await manager.query(FIND_ORDER_ID_SQL, [ref.saleId, ref.userId]);
    if (rows.length === 0) throw new OrderPersistenceRejectedError('SALE_NOT_FOUND', ref.orderId);
    return { outcome: 'ALREADY_PERSISTED', orderId: rows[0].id };
  }
}
