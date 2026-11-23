import type { DataSource, EntityManager } from 'typeorm';
import { SCHEMA_ADVISORY_LOCK_KEY } from '../../src/infrastructure/database/database.constants';
import { ACQUIRE_SCHEMA_LOCK_SQL, SCHEMA_DDL } from '../../src/infrastructure/database/schema.sql';
import { SchemaConstraintsInitializer } from '../../src/infrastructure/database/schema-constraints.initializer';

describe('SchemaConstraintsInitializer & SCHEMA_DDL', () => {
  it('acquires the advisory lock then runs every DDL statement in one transaction', async () => {
    const executed: Array<{ sql: string; params?: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        executed.push({ sql, params });
        return [];
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async <T>(run: (tx: EntityManager) => Promise<T>): Promise<T> => {
        return run(manager);
      }),
    } as unknown as DataSource;

    const initializer = new SchemaConstraintsInitializer(dataSource);
    await initializer.onModuleInit();

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(executed[0]).toEqual({
      sql: ACQUIRE_SCHEMA_LOCK_SQL,
      params: [SCHEMA_ADVISORY_LOCK_KEY],
    });
    expect(executed.slice(1).map((call) => call.sql)).toEqual([...SCHEMA_DDL]);
  });

  it('declares products.created_at and orders.created_at as NOT NULL with default NOW()', () => {
    const productsDdl = SCHEMA_DDL.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS products'),
    );
    const ordersDdl = SCHEMA_DDL.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS orders'));

    expect(productsDdl).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT NOW\(\)/);
    expect(ordersDdl).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT NOW\(\)/);
  });

  it('declares sale price and order status CHECK constraints on table creation', () => {
    const productsDdl = SCHEMA_DDL.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS products'),
    );
    const ordersDdl = SCHEMA_DDL.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS orders'));

    expect(productsDdl).toContain(
      'CONSTRAINT ck_products_sale_price_lte_original CHECK (sale_price_cents <= original_price_cents)',
    );
    expect(ordersDdl).toContain(
      "CONSTRAINT ck_orders_status_valid CHECK (status IN ('CONFIRMED'))",
    );
  });

  it('backfills NULL created_at before setting NOT NULL for existing volumes', () => {
    const backfillProducts = SCHEMA_DDL.findIndex((sql) =>
      /UPDATE\s+products\s+SET\s+created_at\s*=\s*NOW\(\)\s+WHERE\s+created_at\s+IS\s+NULL/i.test(
        sql,
      ),
    );
    const alterProducts = SCHEMA_DDL.findIndex((sql) =>
      /ALTER\s+TABLE\s+products\s+ALTER\s+COLUMN\s+created_at\s+SET\s+NOT\s+NULL/i.test(sql),
    );
    const backfillOrders = SCHEMA_DDL.findIndex((sql) =>
      /UPDATE\s+orders\s+SET\s+created_at\s*=\s*NOW\(\)\s+WHERE\s+created_at\s+IS\s+NULL/i.test(
        sql,
      ),
    );
    const alterOrders = SCHEMA_DDL.findIndex((sql) =>
      /ALTER\s+TABLE\s+orders\s+ALTER\s+COLUMN\s+created_at\s+SET\s+NOT\s+NULL/i.test(sql),
    );

    expect(backfillProducts).toBeGreaterThan(-1);
    expect(alterProducts).toBeGreaterThan(backfillProducts);
    expect(backfillOrders).toBeGreaterThan(-1);
    expect(alterOrders).toBeGreaterThan(backfillOrders);
  });

  it('adds idempotent pg_constraint DO blocks for new CHECK constraints on existing volumes', () => {
    const productUpgrade = SCHEMA_DDL.find(
      (sql) =>
        sql.includes('pg_constraint') &&
        sql.includes('ck_products_sale_price_lte_original') &&
        sql.includes('ADD CONSTRAINT ck_products_sale_price_lte_original'),
    );
    const orderUpgrade = SCHEMA_DDL.find(
      (sql) =>
        sql.includes('pg_constraint') &&
        sql.includes('ck_orders_status_valid') &&
        sql.includes('ADD CONSTRAINT ck_orders_status_valid'),
    );

    expect(productUpgrade).toBeDefined();
    expect(orderUpgrade).toBeDefined();
  });
});
