import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  REDIS_CLIENT,
} from '../../src/infrastructure/redis/redis.constants';
import type { FlashSaleRedis } from '../../src/infrastructure/redis/redis.interfaces';
import { FlashSaleHydrationService } from '../../src/modules/admin/services/flash-sale-hydration.service';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import { CheckoutService } from '../../src/modules/checkout/services/checkout.service';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import { OrderCacheRepository } from '../../src/modules/orders/repositories/order-cache.repository';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { FEATURED_PRODUCT_ID } from '../../src/modules/products/constants/products.constants';
import { userIdOf } from './user-id.fixtures';

/** States from which a job can still run. A reset drains these; finished jobs are history. */
const RUNNABLE_JOB_STATES = ['wait', 'paused', 'delayed', 'active'] as const;

export interface RealSaleHarness {
  moduleRef: TestingModule;
  dataSource: DataSource;
  redis: FlashSaleRedis;
  queue: Queue<ReservationRef>;
  resetService: FlashSaleResetService;
  hydration: FlashSaleHydrationService;
  flashSales: FlashSalesService;
  checkout: CheckoutService;
  ordersRepository: OrdersRepository;
  orderCache: OrderCacheRepository;
  persistOrder(user: string): Promise<ReservationRef>;
  deleteSaleRedisKeys(): Promise<void>;
  deleteSaleRows(): Promise<void>;
  runnableJobCount(): Promise<number>;
  close(): Promise<void>;
}

/**
 * The full AppModule against the real containers. The services hardwire ACTIVE_FLASH_SALE_ID, so
 * specs on top of this harness own the real sale; `close` restores a sane default sale first.
 */
export async function createRealSaleHarness(): Promise<RealSaleHarness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  const get = <T>(token: Parameters<TestingModule['get']>[0]): T =>
    moduleRef.get<T>(token, { strict: false });
  const redis = get<FlashSaleRedis>(REDIS_CLIENT);
  const queue = get<Queue<ReservationRef>>(getQueueToken(ORDER_PERSISTENCE_QUEUE));
  const dataSource = get<DataSource>(DataSource);
  const resetService = get<FlashSaleResetService>(FlashSaleResetService);
  const ordersRepository = get<OrdersRepository>(OrdersRepository);

  return {
    moduleRef,
    dataSource,
    redis,
    queue,
    resetService,
    hydration: get(FlashSaleHydrationService),
    flashSales: get(FlashSalesService),
    checkout: get(CheckoutService),
    ordersRepository,
    orderCache: get(OrderCacheRepository),
    persistOrder: async (user) => {
      const ref = { saleId: ACTIVE_FLASH_SALE_ID, userId: userIdOf(user), orderId: randomUUID() };
      await ordersRepository.persistConfirmedOrder(ref);
      return ref;
    },
    deleteSaleRedisKeys: async () => {
      await redis.del(
        flashSaleConfigKey(ACTIVE_FLASH_SALE_ID),
        flashSaleStockKey(ACTIVE_FLASH_SALE_ID),
        flashSaleUsersKey(ACTIVE_FLASH_SALE_ID),
      );
    },
    deleteSaleRows: async () => {
      await dataSource.query('DELETE FROM orders WHERE flash_sale_id = $1', [ACTIVE_FLASH_SALE_ID]);
      await dataSource.query('DELETE FROM flash_sales WHERE id = $1', [ACTIVE_FLASH_SALE_ID]);
      await dataSource.query('DELETE FROM products WHERE id = $1', [FEATURED_PRODUCT_ID]);
    },
    runnableJobCount: async () => {
      const counts = await queue.getJobCounts(...RUNNABLE_JOB_STATES);
      return RUNNABLE_JOB_STATES.reduce((total, state) => total + counts[state], 0);
    },
    close: async () => {
      await queue.resume();
      await resetService.reset({});
      await moduleRef.close();
    },
  };
}
