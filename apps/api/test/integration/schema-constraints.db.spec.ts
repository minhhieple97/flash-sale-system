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
  'fk_flash_sales_product',
  'ck_flash_sales_total_stock_non_negative',
  'ck_flash_sales_remaining_stock_bounds',
  'ck_flash_sales_window',
  'fk_orders_flash_sale',
  'fk_orders_product',
  'uq_orders_one_per_user',
];
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const WINDOW_START = '2030-01-01T00:00:00Z';
const WINDOW_END = '2030-01-01T01:00:00Z';

interface PgError {
  code: string;
  constraint: string;
}

interface ProductRow {
  id: string;
  sku: string;
  originalPriceCents?: number;
}

interface SaleRow {
  id: string;
  productId: string;
  totalStock: number;
  remainingStock: number;
  endsAt?: string;
}

async function insertProduct(runner: QueryRunner, product: ProductRow): Promise<void> {
  await runner.query(
    `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents)
     VALUES ($1, $2, 'n', 'd', $3, 50)`,
    [product.id, product.sku, product.originalPriceCents ?? 100],
  );
}

async function insertSale(runner: QueryRunner, sale: SaleRow): Promise<void> {
  await runner.query(
    `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sale.id,
      sale.productId,
      sale.totalStock,
      sale.remainingStock,
      WINDOW_START,
      sale.endsAt ?? WINDOW_END,
    ],
  );
}

async function insertOrder(
  runner: QueryRunner,
  ids: { saleId: string; productId: string; userId: string },
): Promise<void> {
  await runner.query(
    `INSERT INTO orders (id, flash_sale_id, product_id, user_id)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), ids.saleId, ids.productId, ids.userId],
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

  it('creates every named constraint', async () => {
    const rows: { conname: string }[] = await dataSource.query(
      'SELECT conname FROM pg_constraint WHERE conname = ANY($1)',
      [EXPECTED_CONSTRAINTS],
    );

    expect(rows.map((row) => row.conname).sort()).toEqual([...EXPECTED_CONSTRAINTS].sort());
  });

  it('is idempotent when run again', async () => {
    await expect(initializer.onModuleInit()).resolves.toBeUndefined();
  });

  it('is lock-safe when run concurrently', async () => {
    const runs = Promise.all([initializer.onModuleInit(), initializer.onModuleInit()]);

    await expect(runs).resolves.toEqual([undefined, undefined]);
  });

  it('rejects a non-positive original price', async () => {
    const error = await violationOf((runner) =>
      insertProduct(runner, { id: randomUUID(), sku: randomUUID(), originalPriceCents: 0 }),
    );

    expect(error).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'ck_products_original_price_positive',
    });
  });

  it('rejects a duplicate sku', async () => {
    const sku = randomUUID();

    const error = await violationOf(async (runner) => {
      await insertProduct(runner, { id: randomUUID(), sku });
      await insertProduct(runner, { id: randomUUID(), sku });
    });

    expect(error).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'uq_products_sku' });
  });

  it.each([
    ['negative remaining stock', { total: 5, remaining: -1 }],
    ['remaining stock above total', { total: 5, remaining: 6 }],
  ])('rejects %s', async (_name, stock) => {
    const productId = randomUUID();

    const error = await violationOf(async (runner) => {
      await insertProduct(runner, { id: productId, sku: randomUUID() });
      await insertSale(runner, {
        id: randomUUID(),
        productId,
        totalStock: stock.total,
        remainingStock: stock.remaining,
      });
    });

    expect(error).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'ck_flash_sales_remaining_stock_bounds',
    });
  });

  it('rejects a window that ends when it starts', async () => {
    const productId = randomUUID();

    const error = await violationOf(async (runner) => {
      await insertProduct(runner, { id: productId, sku: randomUUID() });
      await insertSale(runner, {
        id: randomUUID(),
        productId,
        totalStock: 5,
        remainingStock: 5,
        endsAt: WINDOW_START,
      });
    });

    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint: 'ck_flash_sales_window' });
  });

  it('rejects a second order for the same sale and user', async () => {
    const ids = { saleId: randomUUID(), productId: randomUUID(), userId: randomUUID() };

    const error = await violationOf(async (runner) => {
      await insertProduct(runner, { id: ids.productId, sku: randomUUID() });
      await insertSale(runner, {
        id: ids.saleId,
        productId: ids.productId,
        totalStock: 5,
        remainingStock: 5,
      });
      await insertOrder(runner, ids);
      await insertOrder(runner, ids);
    });

    expect(error).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'uq_orders_one_per_user' });
  });
});
