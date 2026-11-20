import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import {
  CONFIRMED_ORDER_STATUS,
  ORDER_SALE_NOT_FOUND_MESSAGE,
  STOCK_INVARIANT_VIOLATION_MESSAGE,
} from '../constants/orders.constants';
import type {
  ConfirmedReservation,
  PersistOrderResult,
  ReservationRef,
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
const LIST_CONFIRMED_SQL =
  'SELECT id, user_id FROM orders WHERE flash_sale_id = $1 AND status = $2 ORDER BY created_at, id';
const DELETE_BY_SALE_SQL = 'DELETE FROM orders WHERE flash_sale_id = $1';

interface IdRow {
  id: string;
}

interface ConfirmedRow extends IdRow {
  user_id: string;
}

/** TypeORM returns `[rows, affectedCount]` for UPDATE and DELETE, unlike INSERT ... RETURNING and SELECT. */
type MutationResult = [rows: unknown[], affectedCount: number];

/** PostgreSQL side of orders. Ids read back are cast to NormalizedUserId: only this system writes them. */
@Injectable()
export class OrdersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * One transaction: insert the order from the sale row (so product_id never travels in the job),
   * then decrement stock only for a fresh insert. A conflict on (flash_sale_id, user_id) returns
   * the existing order as ALREADY_PERSISTED; stock exhaustion throws and rolls the insert back.
   */
  async persistConfirmedOrder(ref: ReservationRef): Promise<PersistOrderResult> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: IdRow[] = await manager.query(INSERT_ORDER_SQL, [
        ref.orderId,
        ref.userId,
        CONFIRMED_ORDER_STATUS,
        ref.saleId,
      ]);
      if (inserted.length > 0) {
        await this.decrementStock(manager, ref.saleId);
        return { outcome: 'INSERTED', orderId: ref.orderId };
      }
      return this.existingOrder(manager, ref);
    });
  }

  async findConfirmedOrderId(saleId: string, userId: NormalizedUserId): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.query(FIND_ORDER_ID_SQL, [saleId, userId]);
    return rows[0]?.id ?? null;
  }

  async listConfirmed(saleId: string): Promise<readonly ConfirmedReservation[]> {
    const rows: ConfirmedRow[] = await this.dataSource.query(LIST_CONFIRMED_SQL, [
      saleId,
      CONFIRMED_ORDER_STATUS,
    ]);
    return rows.map((row) => ({ userId: row.user_id as NormalizedUserId, orderId: row.id }));
  }

  /** Admin reset. Returns the number of deleted rows. */
  async deleteBySale(saleId: string): Promise<number> {
    const [, deleted]: MutationResult = await this.dataSource.query(DELETE_BY_SALE_SQL, [saleId]);
    return deleted;
  }

  private async decrementStock(manager: EntityManager, saleId: string): Promise<void> {
    const [, updated]: MutationResult = await manager.query(DECREMENT_STOCK_SQL, [saleId]);
    if (updated === 0) throw new Error(STOCK_INVARIANT_VIOLATION_MESSAGE);
  }

  private async existingOrder(
    manager: EntityManager,
    ref: ReservationRef,
  ): Promise<PersistOrderResult> {
    const rows: IdRow[] = await manager.query(FIND_ORDER_ID_SQL, [ref.saleId, ref.userId]);
    if (rows.length === 0) throw new Error(`${ORDER_SALE_NOT_FOUND_MESSAGE}: ${ref.saleId}`);
    return { outcome: 'ALREADY_PERSISTED', orderId: rows[0].id };
  }
}
