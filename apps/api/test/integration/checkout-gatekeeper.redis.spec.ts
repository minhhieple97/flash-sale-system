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
import { END_MS, START_MS } from '../support/flash-sale.fixtures';

const PARALLEL_USERS = 100;
const PARALLEL_STOCK = 10;
const SAME_USER_CALLS = 50;
const SAME_USER_STOCK = 20;

describe('attemptPurchase / rollbackPurchase scripts', () => {
  let moduleRef: TestingModule;
  let redis: FlashSaleRedis;
  const saleIds: string[] = [];

  async function seedSale(stock: number | null, window = { start: START_MS, end: END_MS }) {
    const saleId = randomUUID();
    saleIds.push(saleId);
    await redis.hset(flashSaleConfigKey(saleId), {
      [F.saleId]: saleId,
      [F.startTimeMs]: String(window.start),
      [F.endTimeMs]: String(window.end),
    });
    if (stock !== null) await redis.set(flashSaleStockKey(saleId), String(stock));
    return {
      saleId,
      attempt: (userId: string, nowMs = START_MS, orderId = randomUUID()): Promise<unknown> =>
        redis.attemptPurchase(
          flashSaleConfigKey(saleId),
          flashSaleStockKey(saleId),
          flashSaleUsersKey(saleId),
          userId,
          nowMs,
          orderId,
        ),
      rollback: (userId: string, orderId: string): Promise<unknown> =>
        redis.rollbackPurchase(
          flashSaleStockKey(saleId),
          flashSaleUsersKey(saleId),
          userId,
          orderId,
        ),
      stock: (): Promise<string | null> => redis.get(flashSaleStockKey(saleId)),
      entry: (userId: string): Promise<string | null> =>
        redis.hget(flashSaleUsersKey(saleId), userId),
      usersCount: (): Promise<number> => redis.hlen(flashSaleUsersKey(saleId)),
    };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, RedisModule],
    }).compile();
    await moduleRef.init();
    redis = moduleRef.get<FlashSaleRedis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    const keys = saleIds.flatMap((id) => [
      flashSaleConfigKey(id),
      flashSaleStockKey(id),
      flashSaleUsersKey(id),
    ]);
    await redis.del(...keys);
    await moduleRef.close();
  });

  describe('attemptPurchase', () => {
    it('returns SALE_NOT_CONFIGURED and writes nothing when the config hash is missing', async () => {
      const saleId = randomUUID();
      saleIds.push(saleId);

      const reply = await redis.attemptPurchase(
        flashSaleConfigKey(saleId),
        flashSaleStockKey(saleId),
        flashSaleUsersKey(saleId),
        'alice',
        START_MS,
        randomUUID(),
      );

      expect(reply).toBe('SALE_NOT_CONFIGURED');
      expect(await redis.exists(flashSaleStockKey(saleId), flashSaleUsersKey(saleId))).toBe(0);
    });

    it('applies the sale window inclusively at both ends', async () => {
      const sale = await seedSale(10);

      const beforeStart = await sale.attempt('early', START_MS - 1);
      const atStart = await sale.attempt('first', START_MS);
      const atEnd = await sale.attempt('last', END_MS);
      const afterEnd = await sale.attempt('late', END_MS + 1);

      expect([beforeStart, atStart, atEnd, afterEnd]).toEqual([
        'SALE_UPCOMING',
        'RESERVED',
        'RESERVED',
        'SALE_ENDED',
      ]);
      expect(await sale.stock()).toBe('8');
    });

    it('decrements stock by one and stores the reservation entry for the order', async () => {
      const sale = await seedSale(5);
      const orderId = randomUUID();

      const reply = await sale.attempt('alice', START_MS, orderId);

      expect(reply).toBe('RESERVED');
      expect(await sale.stock()).toBe('4');
      expect(await sale.entry('alice')).toBe(`RESERVED:${orderId}`);
    });

    it('returns ALREADY_PURCHASED for a repeat user and decrements stock only once', async () => {
      const sale = await seedSale(5);
      await sale.attempt('alice');

      const second = await sale.attempt('alice');

      expect(second).toBe('ALREADY_PURCHASED');
      expect(await sale.stock()).toBe('4');
    });

    it('returns SOLD_OUT without adding a users entry when stock is 0', async () => {
      const sale = await seedSale(0);

      const reply = await sale.attempt('alice');

      expect(reply).toBe('SOLD_OUT');
      expect(await sale.usersCount()).toBe(0);
    });

    it('returns SOLD_OUT when the stock key is absent', async () => {
      const sale = await seedSale(null);

      const reply = await sale.attempt('alice');

      expect(reply).toBe('SOLD_OUT');
      expect(await sale.stock()).toBeNull();
    });

    it('reports SALE_ENDED before SOLD_OUT when the window is over and stock is 0', async () => {
      const sale = await seedSale(0);

      const reply = await sale.attempt('alice', END_MS + 1);

      expect(reply).toBe('SALE_ENDED');
    });

    it('reports ALREADY_PURCHASED before SOLD_OUT when the user holds a unit and stock is 0', async () => {
      const sale = await seedSale(1);
      await sale.attempt('alice');

      const reply = await sale.attempt('alice');

      expect(await sale.stock()).toBe('0');
      expect(reply).toBe('ALREADY_PURCHASED');
    });

    it('sells exactly the stock to 100 parallel distinct users', async () => {
      const sale = await seedSale(PARALLEL_STOCK);
      const users = Array.from({ length: PARALLEL_USERS }, (_, index) => `user-${index}`);

      const replies = await Promise.all(users.map((userId) => sale.attempt(userId)));

      expect(replies.filter((reply) => reply === 'RESERVED')).toHaveLength(PARALLEL_STOCK);
      expect(replies.filter((reply) => reply === 'SOLD_OUT')).toHaveLength(
        PARALLEL_USERS - PARALLEL_STOCK,
      );
      expect(await sale.stock()).toBe('0');
      expect(await sale.usersCount()).toBe(PARALLEL_STOCK);
    });

    it('lets one user win once out of 50 parallel calls', async () => {
      const sale = await seedSale(SAME_USER_STOCK);

      const replies = await Promise.all(
        Array.from({ length: SAME_USER_CALLS }, () => sale.attempt('alice')),
      );

      expect(replies.filter((reply) => reply === 'RESERVED')).toHaveLength(1);
      expect(replies.filter((reply) => reply === 'ALREADY_PURCHASED')).toHaveLength(
        SAME_USER_CALLS - 1,
      );
      expect(await sale.stock()).toBe(String(SAME_USER_STOCK - 1));
    });
  });

  describe('rollbackPurchase', () => {
    it('releases a reservation once, restores stock and ignores a repeat call', async () => {
      const sale = await seedSale(5);
      const orderId = randomUUID();
      await sale.attempt('alice', START_MS, orderId);

      const first = await sale.rollback('alice', orderId);
      const second = await sale.rollback('alice', orderId);

      expect([first, second]).toEqual([1, 0]);
      expect(await sale.stock()).toBe('5');
      expect(await sale.entry('alice')).toBeNull();
    });

    it('leaves a CONFIRMED entry and the stock untouched', async () => {
      const sale = await seedSale(4);
      const orderId = randomUUID();
      await redis.hset(flashSaleUsersKey(sale.saleId), 'alice', `CONFIRMED:${orderId}`);

      const reply = await sale.rollback('alice', orderId);

      expect(reply).toBe(0);
      expect(await sale.entry('alice')).toBe(`CONFIRMED:${orderId}`);
      expect(await sale.stock()).toBe('4');
    });

    it('leaves a reservation held by a different order untouched', async () => {
      const sale = await seedSale(5);
      const heldOrderId = randomUUID();
      await sale.attempt('alice', START_MS, heldOrderId);

      const reply = await sale.rollback('alice', randomUUID());

      expect(reply).toBe(0);
      expect(await sale.entry('alice')).toBe(`RESERVED:${heldOrderId}`);
      expect(await sale.stock()).toBe('4');
    });
  });
});
