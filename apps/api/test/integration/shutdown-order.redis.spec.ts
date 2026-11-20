import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Module, type ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import { QueueModule } from '../../src/infrastructure/queue/queue.module';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.constants';
import { RedisModule } from '../../src/infrastructure/redis/redis.module';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { createOrderCacheHarness, type OrderCacheHarness } from '../support/order-cache.harness';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';

const WORKER_CLOSED = 'worker.close resolved';
const QUEUE_CLOSED = 'queue.close resolved';
const REDIS_QUIT = 'redis.quit called';
const STOCK = 5;

interface ShutdownProbe {
  events: string[];
  workerCloseRequested: Promise<void>;
}

/** Records the order in which the real worker and queue finish closing and the shared client quits. */
function probeShutdown(app: TestingModule): ShutdownProbe {
  const events: string[] = [];
  const worker = app.get(OrderPersistenceProcessor, { strict: false }).worker;
  const queue = app.get<Queue>(getQueueToken(ORDER_PERSISTENCE_QUEUE), { strict: false });
  const redis = app.get<Redis>(REDIS_CLIENT, { strict: false });
  const closeWorker = worker.close.bind(worker);
  const closeQueue = queue.close.bind(queue);
  const quit = redis.quit.bind(redis);
  let signalWorkerClose!: () => void;
  const workerCloseRequested = new Promise<void>((resolve) => {
    signalWorkerClose = resolve;
  });

  jest.spyOn(worker, 'close').mockImplementation(async (force) => {
    signalWorkerClose();
    await closeWorker(force);
    events.push(WORKER_CLOSED);
  });
  jest.spyOn(queue, 'close').mockImplementation(async () => {
    await closeQueue();
    events.push(QUEUE_CLOSED);
  });
  jest.spyOn(redis, 'quit').mockImplementation(async () => {
    events.push(REDIS_QUIT);
    return quit();
  });
  return { events, workerCloseRequested };
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
  const app = await Test.createTestingModule({ imports }).compile();
  await app.init();
  return app;
}

describe('application shutdown order', () => {
  let cacheHarness: OrderCacheHarness;
  let db: SaleDbHarness;
  let cleanupQueue: Queue;
  const orderIds: string[] = [];

  beforeAll(async () => {
    cacheHarness = await createOrderCacheHarness();
    db = await createSaleDbHarness();
    const { host, port } = cacheHarness.redis.options;
    cleanupQueue = new Queue(ORDER_PERSISTENCE_QUEUE, { connection: { host, port } });
  });

  afterAll(async () => {
    for (const orderId of orderIds) {
      await (await cleanupQueue.getJob(orderId))?.remove();
    }
    await cleanupQueue.close();
    await db.close();
    await cacheHarness.close();
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
      const saleId = await cacheHarness.seedSale(STOCK);
      await db.seedSale(saleId, STOCK);
      const ref: ReservationRef = await cacheHarness.reserve(saleId, `buyer-${randomUUID()}`);
      orderIds.push(ref.orderId);
      const app = await bootApp(imports);
      const { workerCloseRequested } = probeShutdown(app);
      const ordersRepository = app.get(OrdersRepository, { strict: false });
      const persist = ordersRepository.persistConfirmedOrder.bind(ordersRepository);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signalStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      jest.spyOn(ordersRepository, 'persistConfirmedOrder').mockImplementation(async (job) => {
        if (job.orderId !== ref.orderId) return persist(job);
        signalStarted();
        await gate;
        return persist(job);
      });
      await app.get(OrderPersistenceService, { strict: false }).scheduleReservation(ref);
      await started;

      const closing = app.close();
      await workerCloseRequested;
      release();
      await closing;

      expect(await cacheHarness.cache.findSlot(saleId, ref.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: ref.orderId,
      });
    });
  });
});
