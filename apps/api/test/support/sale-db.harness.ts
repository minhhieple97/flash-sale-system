import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';

const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';

export interface OrderRow {
  id: string;
  user_id: string;
  status: string;
}

export interface SaleDbHarness {
  seedSale(saleId: string, stock: number): Promise<void>;
  deleteSale(saleId: string): Promise<void>;
  ordersOf(saleId: string): Promise<OrderRow[]>;
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
    async seedSale(saleId, stock) {
      saleIds.push(saleId);
      await dataSource.query(
        `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
         VALUES ($1, $2, $3, $3, $4, $5)`,
        [saleId, productId, stock, STARTS_AT, ENDS_AT],
      );
    },
    async deleteSale(saleId) {
      await dataSource.query('DELETE FROM flash_sales WHERE id = $1', [saleId]);
    },
    ordersOf: (saleId) =>
      dataSource.query('SELECT id, user_id, status FROM orders WHERE flash_sale_id = $1', [saleId]),
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
