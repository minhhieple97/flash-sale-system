import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import type { OrderRow } from './order-row.interface';

const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';

export interface SaleDbHarness {
  readonly productId: string;
  /** `totalStock` defaults to `stock`. */
  seedSale(saleId: string, stock: number, totalStock?: number): Promise<void>;
  deleteSale(saleId: string): Promise<void>;
  ordersOf(saleId: string): Promise<OrderRow[]>;
  orderProductIds(saleId: string): Promise<string[]>;
  query(sql: string, params: unknown[]): Promise<unknown>;
  lockSaleRow(saleId: string): Promise<() => Promise<void>>;
  stockOf(saleId: string): Promise<number>;
  close(): Promise<void>;
}

/** Its own PostgreSQL connection, so it keeps working while the app under test shuts down. */
export async function createSaleDbHarness(): Promise<SaleDbHarness> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppConfigModule, DatabaseModule],
  }).compile();
  await moduleRef.init();
  const dataSource = moduleRef.get(DataSource);
  const productId = randomUUID();
  const saleIds: string[] = [];
  await dataSource.query(
    `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents)
     VALUES ($1, $2, 'n', 'd', 100, 50)`,
    [productId, randomUUID()],
  );

  return {
    productId,
    async seedSale(saleId, stock, totalStock = stock) {
      saleIds.push(saleId);
      await dataSource.query(
        `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
         VALUES ($1, $2, $4, $3, $5, $6)`,
        [saleId, productId, stock, totalStock, STARTS_AT, ENDS_AT],
      );
    },
    async deleteSale(saleId) {
      await dataSource.query('DELETE FROM flash_sales WHERE id = $1', [saleId]);
    },
    ordersOf: (saleId) =>
      dataSource.query('SELECT id, user_id, status FROM orders WHERE flash_sale_id = $1', [saleId]),
    async orderProductIds(saleId) {
      const rows: { product_id: string }[] = await dataSource.query(
        'SELECT product_id FROM orders WHERE flash_sale_id = $1',
        [saleId],
      );
      return rows.map((row) => row.product_id);
    },
    query: (sql, params) => dataSource.query(sql, params),
    async lockSaleRow(saleId) {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM flash_sales WHERE id = $1 FOR UPDATE', [saleId]);
      return async () => {
        await runner.rollbackTransaction();
        await runner.release();
      };
    },
    async stockOf(saleId) {
      const rows: { remaining_stock: number }[] = await dataSource.query(
        'SELECT remaining_stock FROM flash_sales WHERE id = $1',
        [saleId],
      );
      return rows[0].remaining_stock;
    },
    async close() {
      await dataSource.query('DELETE FROM orders WHERE flash_sale_id = ANY($1::uuid[])', [saleIds]);
      await dataSource.query('DELETE FROM flash_sales WHERE id = ANY($1::uuid[])', [saleIds]);
      await dataSource.query('DELETE FROM products WHERE id = $1', [productId]);
      await moduleRef.close();
    },
  };
}
