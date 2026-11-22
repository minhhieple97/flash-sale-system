import { randomUUID } from 'node:crypto';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { ORDER_PERSISTENCE_JOB_NAME } from '../../src/modules/orders/constants/orders.constants';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  SALE_CONFIG_FIELDS,
} from '../support/ledger-keys';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';

const RESET_INPUT = { totalStock: 5, startsOffsetSeconds: -60, durationSeconds: 3600 };

describe('FlashSaleResetService against the real containers', () => {
  let harness: RealSaleHarness;
  let staleStatusRemaining: number;
  let status: Awaited<ReturnType<RealSaleHarness['resetService']['reset']>>;

  beforeAll(async () => {
    harness = await createRealSaleHarness();
    await harness.resetService.reset({ totalStock: 9, startsOffsetSeconds: -60 });
    const [alice, bob] = [
      await harness.persistOrder('reset-alice'),
      await harness.persistOrder('reset-bob'),
    ];
    await harness.redis.hset(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID), {
      [alice.userId]: `CONFIRMED:${alice.orderId}`,
      [bob.userId]: `CONFIRMED:${bob.orderId}`,
    });
    await harness.queue.pause();
    const pending = {
      saleId: ACTIVE_FLASH_SALE_ID,
      userId: userIdOf('reset-carol'),
      orderId: randomUUID(),
    };
    await harness.queue.add(ORDER_PERSISTENCE_JOB_NAME, pending, { jobId: pending.orderId });
    staleStatusRemaining = (await harness.flashSales.getCurrentStatus()).remainingStock;

    status = await harness.resetService.reset(RESET_INPUT);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('filled the status micro-cache with the pre-reset sale', () => {
    expect(staleStatusRemaining).toBe(9);
  });

  it('returns a fresh ACTIVE status with the new stock', () => {
    expect(status).toMatchObject({ saleState: 'ACTIVE', totalStock: 5, remainingStock: 5 });
  });

  it('serves the reset status on the next read instead of the cached one', async () => {
    const next = await harness.flashSales.getCurrentStatus();

    expect(next.remainingStock).toBe(5);
  });

  it('deletes the orders of the sale', async () => {
    const rows = await harness.dataSource.query('SELECT id FROM orders WHERE flash_sale_id = $1', [
      ACTIVE_FLASH_SALE_ID,
    ]);

    expect(rows).toHaveLength(0);
  });

  it('drains every job that could still run and leaves the queue resumed', async () => {
    await expect(harness.runnableJobCount()).resolves.toBe(0);
    await expect(harness.queue.isPaused()).resolves.toBe(false);
  });

  it('clears the purchase ledger and resets stock in Redis', async () => {
    await expect(harness.redis.hlen(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe(0);
    await expect(harness.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe('5');
    const configFields = await harness.redis.hkeys(flashSaleConfigKey(ACTIVE_FLASH_SALE_ID));
    expect(configFields.sort()).toEqual(Object.values(SALE_CONFIG_FIELDS).sort());
  });

  it('resets remaining_stock in PostgreSQL', async () => {
    const rows: { remaining_stock: number; total_stock: number }[] = await harness.dataSource.query(
      'SELECT remaining_stock, total_stock FROM flash_sales WHERE id = $1',
      [ACTIVE_FLASH_SALE_ID],
    );

    expect(rows[0]).toEqual({ remaining_stock: 5, total_stock: 5 });
  });
});
