import { randomUUID } from 'node:crypto';
import type { Worker } from 'bullmq';
import type { QueryRunner } from 'typeorm';
import { ClockService } from '../../src/common/providers/clock.service';
import {
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../../src/infrastructure/redis/redis.constants';
import { CheckoutGatekeeperRepository } from '../../src/modules/checkout/repositories/checkout-gatekeeper.repository';
import { ACTIVE_FLASH_SALE_ID as SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';
import { waitFor } from '../support/wait-for';

const TOTAL_STOCK = 5;
const RESET_INPUT = { totalStock: TOTAL_STOCK, startsOffsetSeconds: -60, durationSeconds: 3600 };
const FENCE_SIGNAL_TIMEOUT_MS = 2000;

interface SaleLedger {
  orders: number;
  pgRemaining: number;
  redisStock: number;
  users: Record<string, string>;
}

/** Resolves once the worker is done with the job: completed, failed, or a worker error. */
function jobSettled(worker: Worker, orderId: string): Promise<string> {
  return new Promise((resolve) => {
    const settle = (how: string): void => {
      worker.off('completed', onCompleted).off('failed', onFailed).off('error', onError);
      resolve(how);
    };
    const onCompleted = (job: { id?: string }): void => {
      if (job.id === orderId) settle('completed');
    };
    const onFailed = (job: { id?: string } | undefined): void => {
      if (job?.id === orderId) settle('failed');
    };
    const onError = (error: Error): void => settle(`error: ${error.message}`);
    worker.on('completed', onCompleted).on('failed', onFailed).on('error', onError);
  });
}

/** A second connection holding the sale row lock, so a persistence job blocks inside its transaction. */
async function lockSaleRow(harness: RealSaleHarness): Promise<QueryRunner> {
  const locker = harness.dataSource.createQueryRunner();
  await locker.connect();
  await locker.query('BEGIN');
  await locker.query('SELECT 1 FROM flash_sales WHERE id = $1 FOR UPDATE', [SALE_ID]);
  return locker;
}

describe('admin reset with persistence work in flight (real worker)', () => {
  let harness: RealSaleHarness;
  let worker: Worker;
  const workerErrors: Error[] = [];
  const recordError = (error: Error): void => {
    workerErrors.push(error);
  };

  beforeAll(async () => {
    harness = await createRealSaleHarness();
    worker = harness.moduleRef.get(OrderPersistenceProcessor, { strict: false }).worker;
    worker.on('error', recordError);
  });

  beforeEach(async () => {
    await harness.resetService.reset(RESET_INPUT);
    workerErrors.length = 0;
  });

  afterAll(async () => {
    worker.off('error', recordError);
    await harness.close();
  });

  async function ledger(): Promise<SaleLedger> {
    const [sale]: { remaining_stock: number }[] = await harness.dataSource.query(
      'SELECT remaining_stock FROM flash_sales WHERE id = $1',
      [SALE_ID],
    );
    const [count]: { n: number }[] = await harness.dataSource.query(
      'SELECT count(*)::int AS n FROM orders WHERE flash_sale_id = $1',
      [SALE_ID],
    );
    return {
      orders: count.n,
      pgRemaining: sale.remaining_stock,
      redisStock: Number(await harness.redis.get(flashSaleStockKey(SALE_ID))),
      users: await harness.redis.hgetall(flashSaleUsersKey(SALE_ID)),
    };
  }

  const cleanSale: SaleLedger = {
    orders: 0,
    pgRemaining: TOTAL_STOCK,
    redisStock: TOTAL_STOCK,
    users: {},
  };

  it('waits for a job blocked mid-transaction, so it cannot commit into the new sale', async () => {
    const locker = await lockSaleRow(harness);
    const purchase = await harness.checkout.attemptPurchase(userIdOf('inflight-old'));
    if (purchase.outcome !== 'RESERVED') throw new Error(`purchase was ${purchase.outcome}`);
    const settled = jobSettled(worker, purchase.orderId);
    await waitFor(
      () => harness.queue.getActiveCount(),
      (active) => active === 1,
    );

    const reset = harness.resetService.reset(RESET_INPUT);
    const wasFenced = await waitFor(() => harness.queue.isPaused(), Boolean, {
      timeoutMs: FENCE_SIGNAL_TIMEOUT_MS,
    }).catch(() => false);
    await locker.query('COMMIT');
    await locker.release();
    await reset;
    await settled;

    expect(await ledger()).toEqual(cleanSale);
    expect(workerErrors).toEqual([]);
    expect(wasFenced).toBe(true);
    expect(await harness.queue.isPaused()).toBe(false);
  });

  it('drops a reservation made against the old state whose enqueue lands after the reset', async () => {
    const ref: ReservationRef = {
      saleId: SALE_ID,
      userId: userIdOf('inflight-mid'),
      orderId: randomUUID(),
    };
    const gatekeeper = harness.moduleRef.get(CheckoutGatekeeperRepository, { strict: false });
    const nowMs = harness.moduleRef.get(ClockService, { strict: false }).nowMs();
    expect(await gatekeeper.executeAtomicReservation({ ...ref, nowMs })).toBe('RESERVED');
    await harness.resetService.reset(RESET_INPUT);
    const settled = jobSettled(worker, ref.orderId);

    const persistence = harness.moduleRef.get(OrderPersistenceService, { strict: false });
    const outcome = await persistence.scheduleReservation(ref);
    await settled;

    expect(outcome).toBe('QUEUED');
    expect(await ledger()).toEqual(cleanSale);
    expect(workerErrors).toEqual([]);
  });
});
