import { randomUUID } from 'node:crypto';
import {
  FLASH_SALE_CONFIG_FIELDS,
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../../src/infrastructure/redis/redis.constants';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { ORDER_PERSISTENCE_JOB_NAME } from '../../src/modules/orders/constants/orders.constants';
import { FEATURED_PRODUCT_ID } from '../../src/modules/products/constants/products.constants';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';

const RESET_INPUT = {
  totalStock: 5,
  startsOffsetSeconds: -60,
  durationSeconds: 3600,
  productName: 'Demo Name',
};

async function productNameOf(harness: RealSaleHarness): Promise<string> {
  const rows: { name: string }[] = await harness.dataSource.query(
    'SELECT name FROM products WHERE id = $1',
    [FEATURED_PRODUCT_ID],
  );
  return rows[0].name;
}

describe('FlashSaleResetService against the real containers', () => {
  let harness: RealSaleHarness;
  let nameBeforeReset: string;
  let staleStatusRemaining: number;
  let status: Awaited<ReturnType<RealSaleHarness['resetService']['reset']>>;

  beforeAll(async () => {
    harness = await createRealSaleHarness();
    await harness.resetService.reset({ totalStock: 9, startsOffsetSeconds: -60 });
    const [alice, bob] = [
      await harness.persistOrder('reset-alice'),
      await harness.persistOrder('reset-bob'),
    ];
    await harness.orderCache.markConfirmed(alice);
    await harness.orderCache.markConfirmed(bob);
    await harness.queue.pause();
    const pending = {
      saleId: ACTIVE_FLASH_SALE_ID,
      userId: userIdOf('reset-carol'),
      orderId: randomUUID(),
    };
    await harness.queue.add(ORDER_PERSISTENCE_JOB_NAME, pending, { jobId: pending.orderId });
    staleStatusRemaining = (await harness.flashSales.getCurrentStatus()).remainingStock;
    nameBeforeReset = await productNameOf(harness);

    status = await harness.resetService.reset(RESET_INPUT);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('filled the status micro-cache with the pre-reset sale', () => {
    expect(staleStatusRemaining).toBe(9);
  });

  it('returns a fresh ACTIVE status with the new stock and the overridden name', () => {
    expect(status).toMatchObject({
      saleState: 'ACTIVE',
      totalStock: 5,
      remainingStock: 5,
      productName: 'Demo Name',
    });
  });

  it('serves the reset status on the next read instead of the cached one', async () => {
    const next = await harness.flashSales.getCurrentStatus();

    expect(next.remainingStock).toBe(5);
    expect(next.productName).toBe('Demo Name');
  });

  it('deletes the orders of the sale', async () => {
    const rows = await harness.dataSource.query('SELECT id FROM orders WHERE flash_sale_id = $1', [
      ACTIVE_FLASH_SALE_ID,
    ]);

    expect(rows).toHaveLength(0);
  });

  it('empties the persistence queue', async () => {
    await expect(harness.queuedJobCount()).resolves.toBe(0);
  });

  it('clears the purchase ledger and resets stock in Redis', async () => {
    await expect(harness.redis.hlen(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe(0);
    await expect(harness.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe('5');
    await expect(
      harness.redis.hget(
        flashSaleConfigKey(ACTIVE_FLASH_SALE_ID),
        FLASH_SALE_CONFIG_FIELDS.productName,
      ),
    ).resolves.toBe('Demo Name');
  });

  it('resets remaining_stock in PostgreSQL and leaves the products row name unchanged', async () => {
    const rows: { remaining_stock: number; total_stock: number }[] = await harness.dataSource.query(
      'SELECT remaining_stock, total_stock FROM flash_sales WHERE id = $1',
      [ACTIVE_FLASH_SALE_ID],
    );

    expect(rows[0]).toEqual({ remaining_stock: 5, total_stock: 5 });
    await expect(productNameOf(harness)).resolves.toBe(nameBeforeReset);
  });
});
