import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { AppModule } from '../../src/app.module';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import {
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../../src/infrastructure/redis/redis.constants';
import {
  CONFIRMED_ORDER_STATUS,
  ORDER_PERSISTENCE_ATTEMPTS,
  ORDER_PERSISTENCE_CONCURRENCY,
  orderCompensationJobId,
  orderPersistenceJobId,
} from '../../src/modules/orders/constants/orders.constants';
import type {
  ReservationRef,
  ReservationSlot,
} from '../../src/modules/orders/interfaces/order.interface';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { createOrderCacheHarness, type OrderCacheHarness } from '../support/order-cache.harness';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { waitFor } from '../support/wait-for';

const STOCK = 5;
const FAILURE_TIMEOUT_MS = 15000;

interface FailedAttempt {
  attemptsMade: number;
  attempts: number | undefined;
}

describe('order persistence pipeline (real worker)', () => {
  let app: TestingModule;
  let queue: Queue<ReservationRef>;
  let processor: OrderPersistenceProcessor;
  let persistence: OrderPersistenceService;
  let cacheHarness: OrderCacheHarness;
  let db: SaleDbHarness;
  const refs: ReservationRef[] = [];

  async function reserveOnNewSale(): Promise<ReservationRef> {
    const saleId = await cacheHarness.seedSale(STOCK);
    await db.seedSale(saleId, STOCK);
    return reserveFor(saleId);
  }

  async function reserveFor(saleId: string): Promise<ReservationRef> {
    const ref = await cacheHarness.reserve(saleId, `buyer-${randomUUID()}`);
    refs.push(ref);
    return ref;
  }

  const slotOf = (ref: ReservationRef): Promise<ReservationSlot> =>
    cacheHarness.cache.findSlot(ref.saleId, ref.userId);

  beforeAll(async () => {
    cacheHarness = await createOrderCacheHarness();
    db = await createSaleDbHarness();
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    queue = app.get<Queue<ReservationRef>>(getQueueToken(ORDER_PERSISTENCE_QUEUE), {
      strict: false,
    });
    processor = app.get(OrderPersistenceProcessor, { strict: false });
    persistence = app.get(OrderPersistenceService, { strict: false });
  });

  afterAll(async () => {
    for (const ref of refs) {
      await (await queue.getJob(orderPersistenceJobId(ref)))?.remove();
      await (await queue.getJob(orderCompensationJobId(ref)))?.remove();
    }
    await app.close();
    await db.close();
    await cacheHarness.close();
  });

  it('builds the worker with the configured concurrency', () => {
    expect(processor.worker.opts.concurrency).toBe(ORDER_PERSISTENCE_CONCURRENCY);
  });

  it('turns a reservation into a CONFIRMED order and decrements stock once', async () => {
    const ref = await reserveOnNewSale();

    const outcome = await persistence.scheduleReservation(ref);
    const slot = await waitFor(
      () => slotOf(ref),
      (value) => value.status === 'CONFIRMED',
    );

    expect(outcome).toBe('QUEUED');
    expect(slot).toEqual({ status: 'CONFIRMED', orderId: ref.orderId });
    expect(await db.ordersOf(ref.saleId)).toEqual([
      { id: ref.orderId, user_id: ref.userId, status: CONFIRMED_ORDER_STATUS },
    ]);
    expect(await db.stockOf(ref.saleId)).toBe(STOCK - 1);
  });

  it(
    'releases the reservation once the final attempt fails, leaving no ghost entry',
    async () => {
      const saleId = await cacheHarness.seedSale(STOCK);
      await db.seedSale(saleId, STOCK);
      await db.deleteSale(saleId);
      const ref = await reserveFor(saleId);
      const attempts: FailedAttempt[] = [];
      const record = (job: Job<ReservationRef> | undefined): void => {
        if (job?.data.orderId !== ref.orderId) return;
        attempts.push({ attemptsMade: job.attemptsMade, attempts: job.opts.attempts });
      };
      processor.worker.on('failed', record);

      await persistence.scheduleReservation(ref);
      const stock = await waitFor(
        () => cacheHarness.redis.get(flashSaleStockKey(saleId)),
        (value) => value === String(STOCK),
        { timeoutMs: FAILURE_TIMEOUT_MS },
      );
      processor.worker.off('failed', record);

      expect(stock).toBe(String(STOCK));
      expect(await cacheHarness.redis.hexists(flashSaleUsersKey(saleId), ref.userId)).toBe(0);
      expect(attempts.map((attempt) => attempt.attemptsMade)).toEqual([1, 2, 3, 4, 5]);
      expect(attempts[attempts.length - 1].attempts).toBe(ORDER_PERSISTENCE_ATTEMPTS);
    },
    FAILURE_TIMEOUT_MS + 5000,
  );
});
