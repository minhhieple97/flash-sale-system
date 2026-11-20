import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module';
import {
  FLASH_SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  REDIS_CLIENT,
} from '../../src/infrastructure/redis/redis.constants';
import type { FlashSaleRedis } from '../../src/infrastructure/redis/redis.interfaces';
import { RedisModule } from '../../src/infrastructure/redis/redis.module';
import { CheckoutGatekeeperRepository } from '../../src/modules/checkout/repositories/checkout-gatekeeper.repository';
import { FlashSaleCacheRepository } from '../../src/modules/flash-sales/repositories/flash-sale-cache.repository';
import type {
  ReservationRef,
  SaleLedgerState,
} from '../../src/modules/orders/interfaces/order.interface';
import { OrderCacheRepository } from '../../src/modules/orders/repositories/order-cache.repository';
import { buildSnapshot, START_MS } from './flash-sale.fixtures';
import { userIdOf } from './user-id.fixtures';

export interface OrderCacheHarness {
  redis: FlashSaleRedis;
  cache: OrderCacheRepository;
  snapshots: FlashSaleCacheRepository;
  newSaleId(): string;
  seedSale(stock: number): Promise<string>;
  reserve(saleId: string, user: string): Promise<ReservationRef>;
  stateOf(saleId: string, overrides?: Partial<SaleLedgerState>): SaleLedgerState;
  close(): Promise<void>;
}

/** Real Redis plus the real gatekeeper, so RESERVED entries come from the Lua script. */
export async function createOrderCacheHarness(): Promise<OrderCacheHarness> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppConfigModule, RedisModule],
    providers: [OrderCacheRepository, CheckoutGatekeeperRepository, FlashSaleCacheRepository],
  }).compile();
  await moduleRef.init();
  const redis = moduleRef.get<FlashSaleRedis>(REDIS_CLIENT);
  const gatekeeper = moduleRef.get(CheckoutGatekeeperRepository);
  const saleIds: string[] = [];

  const newSaleId = (): string => {
    const saleId = randomUUID();
    saleIds.push(saleId);
    return saleId;
  };

  return {
    redis,
    cache: moduleRef.get(OrderCacheRepository),
    snapshots: moduleRef.get(FlashSaleCacheRepository),
    newSaleId,
    async seedSale(stock) {
      const saleId = newSaleId();
      await redis.hset(flashSaleConfigKey(saleId), {
        [F.saleId]: saleId,
        [F.startTimeMs]: String(START_MS),
        [F.endTimeMs]: String(START_MS + 1000),
      });
      await redis.set(flashSaleStockKey(saleId), String(stock));
      return saleId;
    },
    async reserve(saleId, user) {
      const ref = { saleId, userId: userIdOf(user), orderId: randomUUID() };
      const verdict = await gatekeeper.executeAtomicReservation({ ...ref, nowMs: START_MS });
      if (verdict !== 'RESERVED') throw new Error(`fixture reservation was ${verdict}`);
      return ref;
    },
    stateOf: (saleId, overrides = {}) => ({
      snapshot: buildSnapshot({ saleId }),
      confirmed: [],
      ...overrides,
    }),
    async close() {
      const keys = saleIds.flatMap((id) => [
        flashSaleConfigKey(id),
        flashSaleStockKey(id),
        flashSaleUsersKey(id),
      ]);
      if (keys.length > 0) await redis.del(...keys);
      await moduleRef.close();
    },
  };
}
