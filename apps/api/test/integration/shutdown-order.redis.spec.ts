import { randomUUID } from 'node:crypto';
import { Module, type ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import {
  ORDER_PERSISTENCE_PRODUCER,
  ORDER_PERSISTENCE_QUEUE,
} from '../../src/infrastructure/queue/queue.constants';
import { QueueModule } from '../../src/infrastructure/queue/queue.module';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.constants';
import { RedisModule } from '../../src/infrastructure/redis/redis.module';
import {
  LEDGER_MAINTENANCE_INTERVAL,
  MAINTENANCE_DISABLED,
} from '../../src/modules/admin/constants/admin.constants';
import { LedgerMaintenanceService } from '../../src/modules/admin/services/ledger-maintenance.service';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { SaleLedgerRepository } from '../../src/modules/sale-ledger';
import { deferred } from '../support/deferred';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';

const WORKER_CLOSED = 'worker.close resolved';
const QUEUE_CLOSED = 'queue.close resolved';
const REDIS_QUIT = 'redis.quit called';
const TICK_DONE = 'maintenance tick resolved';
const STOCK = 5;
const HELD_TICK_MS = 300;

interface ShutdownProbe {
  events: string[];
  workerCloseRequested: Promise<void>;
  queueClosed: Promise<void>;
}

/** Records the order in which the real worker and queue finish closing and the shared client quits. */
function probeShutdown(app: TestingModule): ShutdownProbe {
  const events: string[] = [];
  const worker = app.get(OrderPersistenceProcessor, { strict: false }).worker;
  const queue = app.get<Queue>(ORDER_PERSISTENCE_PRODUCER, { strict: false });
  const redis = app.get<Redis>(REDIS_CLIENT, { strict: false });
  const closeWorker = worker.close.bind(worker);
  const closeQueue = queue.close.bind(queue);
  const quit = redis.quit.bind(redis);
  const workerCloseRequested = deferred();
  const queueClosed = deferred();

  jest.spyOn(worker, 'close').mockImplementation(async (force) => {
    workerCloseRequested.resolve();
    await closeWorker(force);
    events.push(WORKER_CLOSED);
  });
  jest.spyOn(queue, 'close').mockImplementation(async () => {
    await closeQueue();
    events.push(QUEUE_CLOSED);
    queueClosed.resolve();
  });
  jest.spyOn(redis, 'quit').mockImplementation(async () => {
    events.push(REDIS_QUIT);
    return quit();
  });
  return {
    events,
    workerCloseRequested: workerCloseRequested.promise,
    queueClosed: queueClosed.promise,
  };
}

@Module({ imports: [OrdersModule] })
class InnerConsumerModule {}

@Module({ imports: [InnerConsumerModule] })
class OuterConsumerModule {}

/**
 * Nest destroys shallower modules first, and a module reached again later keeps its dependencies
 * at the distance of its first visit. With RedisModule and OrdersModule at the root and
 * OrdersModule imported again two levels down (as CheckoutModule and AdminModule will), Redis is
 * shallower than Orders, so a Redis quit in the destroy phase would run before the worker closes.
 */
const ARRANGEMENTS: ReadonlyArray<readonly [string, ModuleMetadata['imports']]> = [
  ['the real AppModule', [AppModule]],
  [
    'RedisModule shallower than OrdersModule',
    [AppConfigModule, DatabaseModule, QueueModule, RedisModule, OrdersModule, OuterConsumerModule],
  ],
];

async function bootApp(imports: ModuleMetadata['imports']): Promise<TestingModule> {
  const app = await Test.createTestingModule({ imports })
    .overrideProvider(LEDGER_MAINTENANCE_INTERVAL)
    .useValue(MAINTENANCE_DISABLED)
    .compile();
  await app.init();
  return app;
}

describe('application shutdown order', () => {
  let ledgerHarness: SaleLedgerHarness;
  let db: SaleDbHarness;
  let cleanupQueue: Queue;
  const orderIds: string[] = [];

  beforeAll(async () => {
    ledgerHarness = await createSaleLedgerHarness();
    db = await createSaleDbHarness();
    const { host, port } = ledgerHarness.redis.options;
    cleanupQueue = new Queue(ORDER_PERSISTENCE_QUEUE, { connection: { host, port } });
  });

  afterAll(async () => {
    for (const orderId of orderIds) {
      await (await cleanupQueue.getJob(orderId))?.remove();
    }
    await cleanupQueue.close();
    await db.close();
    await ledgerHarness.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(ARRANGEMENTS)('with %s', (_name, imports) => {
    it('closes the worker and the queue before the shared Redis client quits', async () => {
      const app = await bootApp(imports);
      const { events } = probeShutdown(app);

      await app.close();

      const quitAt = events.indexOf(REDIS_QUIT);
      expect(quitAt).toBeGreaterThan(-1);
      expect(events.slice(0, quitAt)).toEqual(
        expect.arrayContaining([WORKER_CLOSED, QUEUE_CLOSED]),
      );
    });

    it('lets an in-flight job mark its order CONFIRMED before Redis quits', async () => {
      const saleId = await ledgerHarness.seedSale(STOCK);
      await db.seedSale(saleId, STOCK);
      const ref: ReservationRef = await ledgerHarness.reserve(saleId, `buyer-${randomUUID()}`);
      orderIds.push(ref.orderId);
      const app = await bootApp(imports);
      const { workerCloseRequested } = probeShutdown(app);
      const ordersRepository = app.get(OrdersRepository, { strict: false });
      const persist = ordersRepository.persistConfirmedOrder.bind(ordersRepository);
      const release = deferred();
      const started = deferred();
      jest.spyOn(ordersRepository, 'persistConfirmedOrder').mockImplementation(async (job) => {
        if (job.orderId !== ref.orderId) return persist(job);
        started.resolve();
        await release.promise;
        return persist(job);
      });
      await app.get(OrderPersistenceService, { strict: false }).scheduleReservation(ref);
      await started.promise;

      const closing = app.close();
      await workerCloseRequested;
      release.resolve();
      await closing;

      expect(await ledgerHarness.ledger.findSlot(saleId, ref.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: ref.orderId,
      });
    });
  });

  it('finishes a maintenance tick blocked mid-sweep before the queue closes', async () => {
    const app = await bootApp([AppModule]);
    const { events, queueClosed } = probeShutdown(app);
    const cache = app.get(SaleLedgerRepository, { strict: false });
    const list = cache.listPendingReservations.bind(cache);
    const sweepStarted = deferred();
    const release = deferred();
    jest
      .spyOn(cache, 'listPendingReservations')
      .mockImplementationOnce(async (saleId, olderThan) => {
        sweepStarted.resolve();
        await release.promise;
        return list(saleId, olderThan);
      });
    const tick = app
      .get(LedgerMaintenanceService, { strict: false })
      .tick()
      .finally(() => events.push(TICK_DONE));
    await sweepStarted.promise;

    const closing = app.close();
    await Promise.race([queueClosed, new Promise((resolve) => setTimeout(resolve, HELD_TICK_MS))]);
    release.resolve();
    const [result] = await Promise.all([tick, closing]);

    expect(result.status).toBe('RAN');
    expect(events.indexOf(TICK_DONE)).toBeGreaterThan(-1);
    expect(events.indexOf(TICK_DONE)).toBeLessThan(events.indexOf(QUEUE_CLOSED));
  });
});
