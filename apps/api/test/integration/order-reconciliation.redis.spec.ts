import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { type ConnectionOptions, type Queue, Worker } from 'bullmq';
import { ClockService } from '../../src/common/providers/clock.service';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import { QueueModule } from '../../src/infrastructure/queue/queue.module';
import { flashSaleStockKey } from '../../src/infrastructure/redis/redis.constants';
import { ORDER_PERSISTENCE_JOB_NAME } from '../../src/modules/orders/constants/orders.constants';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { createOrderCacheHarness, type OrderCacheHarness } from '../support/order-cache.harness';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';

const STOCK = 2;
const NO_ORPHANS = { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 };

/**
 * Boot reconciliation against real PostgreSQL, Redis and the real order-persistence queue. No worker
 * runs: jobs stay where the spec puts them, and a failed job is produced by hand through a
 * non-running Worker.
 */
describe('boot reconciliation of orphaned reservations', () => {
  let cacheHarness: OrderCacheHarness;
  let db: SaleDbHarness;
  let moduleRef: TestingModule;
  let queue: Queue<ReservationRef>;
  let driver: Worker<ReservationRef>;
  let ordersRepository: OrdersRepository;
  let service: OrderPersistenceService;
  const jobIds: string[] = [];

  beforeAll(async () => {
    cacheHarness = await createOrderCacheHarness();
    db = await createSaleDbHarness();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        DatabaseModule,
        QueueModule,
        BullModule.registerQueue({ name: ORDER_PERSISTENCE_QUEUE }),
      ],
      providers: [OrdersRepository],
    }).compile();
    await moduleRef.init();
    queue = moduleRef.get<Queue<ReservationRef>>(getQueueToken(ORDER_PERSISTENCE_QUEUE));
    await queue.resume();
    driver = new Worker<ReservationRef>(ORDER_PERSISTENCE_QUEUE, undefined, {
      connection: queue.opts.connection as ConnectionOptions,
      autorun: false,
    });
    ordersRepository = moduleRef.get(OrdersRepository);
    service = new OrderPersistenceService(
      queue,
      ordersRepository,
      cacheHarness.cache,
      new ClockService(),
    );
  });

  afterAll(async () => {
    for (const jobId of jobIds) await (await queue.getJob(jobId))?.remove();
    await driver.close();
    await queue.close();
    await moduleRef.close();
    await db.close();
    await cacheHarness.close();
  });

  async function reserveInFreshSale(): Promise<ReservationRef> {
    const saleId = await cacheHarness.seedSale(STOCK);
    await db.seedSale(saleId, STOCK);
    return cacheHarness.reserve(saleId, 'alice');
  }

  async function enqueuePersistence(ref: ReservationRef): Promise<void> {
    jobIds.push(ref.orderId);
    await queue.add(ORDER_PERSISTENCE_JOB_NAME, ref, {
      jobId: ref.orderId,
      attempts: 1,
      lifo: true,
    });
  }

  /** `lifo` puts the job at the head of the wait list, so the driver takes this job and no other. */
  async function failPersistenceJob(ref: ReservationRef): Promise<void> {
    await enqueuePersistence(ref);
    const token = randomUUID();
    const job = await driver.getNextJob(token, { block: false });
    if (job?.id !== ref.orderId) throw new Error(`driver took job ${job?.id}, not ${ref.orderId}`);
    await job.moveToFailed(new Error('retries exhausted'), token, false);
  }

  const redisStockOf = async (saleId: string): Promise<number> =>
    Number(await cacheHarness.redis.get(flashSaleStockKey(saleId)));

  it('releases a reservation that never got a job and returns its unit to the stock', async () => {
    const ref = await reserveInFreshSale();

    const summary = await service.reconcileOrphanedReservations(ref.saleId);

    expect(summary).toEqual({ pending: 0, orphans: { ...NO_ORPHANS, RELEASED: 1 } });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK);
    expect(await cacheHarness.cache.findSlot(ref.saleId, ref.userId)).toEqual({ status: 'NONE' });
  });

  it('leaves a reservation whose persistence job is still waiting untouched', async () => {
    const ref = await reserveInFreshSale();
    await enqueuePersistence(ref);

    const summary = await service.reconcileOrphanedReservations(ref.saleId);

    expect(summary).toEqual({ pending: 1, orphans: NO_ORPHANS });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK - 1);
    expect(await cacheHarness.cache.findSlot(ref.saleId, ref.userId)).toEqual({
      status: 'RESERVED',
      orderId: ref.orderId,
    });
  });

  it('confirms an orphan whose order PostgreSQL already holds and keeps its unit sold', async () => {
    const ref = await reserveInFreshSale();
    await ordersRepository.persistConfirmedOrder(ref);

    const summary = await service.reconcileOrphanedReservations(ref.saleId);

    expect(summary).toEqual({ pending: 0, orphans: { ...NO_ORPHANS, CONFIRMED: 1 } });
    expect(await cacheHarness.cache.findSlot(ref.saleId, ref.userId)).toEqual({
      status: 'CONFIRMED',
      orderId: ref.orderId,
    });
    expect(await redisStockOf(ref.saleId)).toBe(await db.stockOf(ref.saleId));
  });

  it('compensates a reservation whose persistence job failed with no compensation job queued', async () => {
    const ref = await reserveInFreshSale();
    await failPersistenceJob(ref);
    expect(await queue.getJobState(ref.orderId)).toBe('failed');

    const summary = await service.reconcileOrphanedReservations(ref.saleId);

    expect(summary).toEqual({ pending: 0, orphans: { ...NO_ORPHANS, RELEASED: 1 } });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK);
    expect(await db.ordersOf(ref.saleId)).toEqual([]);
  });
});
