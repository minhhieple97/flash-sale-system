import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { DataSource, type QueryRunner } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { SchemaConstraintsInitializer } from '../../src/infrastructure/database/schema-constraints.initializer';

const EXPECTED_CONSTRAINTS = [
  'uq_products_sku',
  'ck_products_original_price_positive',
  'ck_products_sale_price_positive',
  'ck_products_sale_price_lte_original',
  'fk_flash_sales_product',
  'ck_flash_sales_total_stock_non_negative',
  'ck_flash_sales_remaining_stock_bounds',
  'ck_flash_sales_window',
  'fk_orders_flash_sale',
  'fk_orders_product',
  'uq_orders_one_per_user',
  'ck_orders_status_valid',
];
const EXPECTED_INDEXES = ['idx_orders_sale_status_created', 'idx_flash_sales_product_id'];
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const WINDOW_START = '2030-01-01T00:00:00Z';
const WINDOW_END = '2030-01-01T01:00:00Z';

interface PgError {
  code: string;
  constraint?: string;
  column?: string;
}

interface ProductInput {
  sku?: string;
  original?: number;
  sale?: number;
}

async function insertProduct(runner: QueryRunner, product: ProductInput = {}): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents)
     VALUES ($1, $2, 'n', 'd', $3, $4)`,
    [id, product.sku ?? randomUUID(), product.original ?? 100, product.sale ?? 50],
  );
  return id;
}

async function insertSale(
  runner: QueryRunner,
  productId: string,
  total = 5,
  remaining = 5,
  endsAt = WINDOW_END,
): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, productId, total, remaining, WINDOW_START, endsAt],
  );
  return id;
}

async function insertOrder(
  runner: QueryRunner,
  saleId: string,
  productId: string,
  userId: string,
  status = 'CONFIRMED',
): Promise<void> {
  await runner.query(
    `INSERT INTO orders (id, flash_sale_id, product_id, user_id, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), saleId, productId, userId, status],
  );
}

describe('SchemaConstraintsInitializer', () => {
  let moduleRef: Awaited<ReturnType<typeof createModule>>;
  let dataSource: DataSource;
  let initializer: SchemaConstraintsInitializer;

  async function createModule() {
    return Test.createTestingModule({ imports: [AppConfigModule, DatabaseModule] }).compile();
  }

  async function violationOf(probe: (runner: QueryRunner) => Promise<void>): Promise<PgError> {
    const runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    try {
      await probe(runner);
    } catch (error) {
      return error as PgError;
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    throw new Error('expected the statement to be rejected');
  }

  beforeAll(async () => {
    moduleRef = await createModule();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
    initializer = moduleRef.get(SchemaConstraintsInitializer);
    await initializer.onModuleInit();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('creates every named constraint and index', async () => {
    const constraints: { conname: string }[] = await dataSource.query(
      'SELECT conname FROM pg_constraint WHERE conname = ANY($1)',
      [EXPECTED_CONSTRAINTS],
    );
    const indexes: { indexname: string }[] = await dataSource.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [EXPECTED_INDEXES],
    );

    expect(constraints.map((row) => row.conname).sort()).toEqual([...EXPECTED_CONSTRAINTS].sort());
    expect(indexes.map((row) => row.indexname).sort()).toEqual([...EXPECTED_INDEXES].sort());
  });

  it('is idempotent and lock-safe when run repeatedly or concurrently', async () => {
    await expect(initializer.onModuleInit()).resolves.toBeUndefined();
    const runs = Promise.all([initializer.onModuleInit(), initializer.onModuleInit()]);
    await expect(runs).resolves.toEqual([undefined, undefined]);
  });

  it.each([
    ['non-positive original price', { original: 0 }, 'ck_products_original_price_positive'],
    [
      'sale price above original price',
      { original: 100, sale: 101 },
      'ck_products_sale_price_lte_original',
    ],
  ])('rejects product with %s', async (_label, prices, constraint) => {
    const error = await violationOf(async (runner) => {
      await insertProduct(runner, prices);
    });
    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint });
  });

  it('rejects a duplicate sku', async () => {
    const sku = randomUUID();
    const error = await violationOf(async (runner) => {
      await insertProduct(runner, { sku });
      await insertProduct(runner, { sku });
    });
    expect(error).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'uq_products_sku' });
  });

  it('rejects NULL created_at on products and orders', async () => {
    const productError = await violationOf((runner) =>
      runner.query(
        `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents, created_at)
         VALUES ($1, $2, 'n', 'd', 100, 50, NULL)`,
        [randomUUID(), randomUUID()],
      ),
    );
    const orderError = await violationOf(async (runner) => {
      const productId = await insertProduct(runner);
      const saleId = await insertSale(runner, productId, 5, 5);
      await runner.query(
        `INSERT INTO orders (id, flash_sale_id, product_id, user_id, created_at)
         VALUES ($1, $2, $3, $4, NULL)`,
        [randomUUID(), saleId, productId, randomUUID()],
      );
    });

    expect(productError).toMatchObject({ code: NOT_NULL_VIOLATION, column: 'created_at' });
    expect(orderError).toMatchObject({ code: NOT_NULL_VIOLATION, column: 'created_at' });
  });

  it.each([
    ['negative remaining stock', 5, -1, WINDOW_END, 'ck_flash_sales_remaining_stock_bounds'],
    ['remaining stock above total', 5, 6, WINDOW_END, 'ck_flash_sales_remaining_stock_bounds'],
    ['window ending at start', 5, 5, WINDOW_START, 'ck_flash_sales_window'],
  ])('rejects flash_sales with %s', async (_label, total, remaining, endsAt, constraint) => {
    const error = await violationOf(async (runner) => {
      const productId = await insertProduct(runner);
      await insertSale(runner, productId, total, remaining, endsAt);
    });
    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint });
  });

  it('rejects duplicate user orders and invalid order status', async () => {
    const duplicateError = await violationOf(async (runner) => {
      const productId = await insertProduct(runner);
      const saleId = await insertSale(runner, productId, 5, 5);
      const userId = randomUUID();
      await insertOrder(runner, saleId, productId, userId);
      await insertOrder(runner, saleId, productId, userId);
    });
    const statusError = await violationOf(async (runner) => {
      const productId = await insertProduct(runner);
      const saleId = await insertSale(runner, productId, 5, 5);
      await insertOrder(runner, saleId, productId, randomUUID(), 'PENDING');
    });

    expect(duplicateError).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'uq_orders_one_per_user',
    });
    expect(statusError).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'ck_orders_status_valid',
    });
  });
});
