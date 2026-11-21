import { randomUUID } from 'node:crypto';
import {
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../../src/infrastructure/redis/redis.constants';
import { createOrderCacheHarness, type OrderCacheHarness } from '../support/order-cache.harness';
import { userIdOf } from '../support/user-id.fixtures';

describe('OrderCacheRepository', () => {
  let harness: OrderCacheHarness;
  let redis: OrderCacheHarness['redis'];
  let cache: OrderCacheHarness['cache'];
  let seedSale: OrderCacheHarness['seedSale'];
  let reserve: OrderCacheHarness['reserve'];

  beforeAll(async () => {
    harness = await createOrderCacheHarness();
    ({ redis, cache, seedSale, reserve } = harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('findSlot', () => {
    it('returns NONE for a user without an entry', async () => {
      const saleId = await seedSale(5);

      const slot = await cache.findSlot(saleId, userIdOf('alice'));

      expect(slot).toEqual({ status: 'NONE' });
    });

    it('returns RESERVED with the order id the Lua gatekeeper wrote', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      const slot = await cache.findSlot(saleId, ref.userId);

      expect(slot).toEqual({ status: 'RESERVED', orderId: ref.orderId });
    });

    it('returns CONFIRMED after markConfirmed', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      await cache.markConfirmed(ref);

      const slot = await cache.findSlot(saleId, ref.userId);

      expect(slot).toEqual({ status: 'CONFIRMED', orderId: ref.orderId });
    });

    it.each([
      ['an unknown prefix', 'BOGUS:abc'],
      ['a RESERVED entry without an id', 'RESERVED:'],
      ['a CONFIRMED entry without an id', 'CONFIRMED:'],
      ['a value without a prefix', 'abc'],
    ])('rejects %s', async (_name, raw) => {
      const saleId = await seedSale(5);
      await redis.hset(flashSaleUsersKey(saleId), 'alice', raw);

      const lookup = cache.findSlot(saleId, userIdOf('alice'));

      await expect(lookup).rejects.toThrow();
    });
  });

  describe('listReservations', () => {
    it('returns the RESERVED entries as refs and skips CONFIRMED ones', async () => {
      const saleId = await seedSale(5);
      const alice = await reserve(saleId, 'alice');
      await cache.markConfirmed(await reserve(saleId, 'bob'));

      const refs = await cache.listReservations(saleId);

      expect(refs).toEqual([alice]);
    });

    it('returns nothing for a sale without a users hash', async () => {
      const refs = await cache.listReservations(harness.newSaleId());

      expect(refs).toEqual([]);
    });

    it('walks a users hash larger than one scan batch, each entry once', async () => {
      const saleId = await seedSale(5);
      const entries = Array.from({ length: 1200 }, (_, index) => [`user-${index}`, randomUUID()]);
      await redis.hset(
        flashSaleUsersKey(saleId),
        Object.fromEntries(entries.map(([user, orderId]) => [user, `RESERVED:${orderId}`])),
      );

      const refs = await cache.listReservations(saleId);

      expect(refs).toHaveLength(entries.length);
      expect(new Set(refs.map((ref) => ref.orderId))).toEqual(
        new Set(entries.map(([, orderId]) => orderId)),
      );
    });
  });

  describe('markConfirmed', () => {
    it('is idempotent', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      await cache.markConfirmed(ref);
      await cache.markConfirmed(ref);

      expect(await cache.findSlot(saleId, ref.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: ref.orderId,
      });
      expect(await redis.hlen(flashSaleUsersKey(saleId))).toBe(1);
    });
  });

  describe('releaseReservation', () => {
    it('releases a RESERVED entry, restores stock, then reports NOT_RESERVED on repeat', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      const first = await cache.releaseReservation(ref);
      const second = await cache.releaseReservation(ref);

      expect([first, second]).toEqual(['RELEASED', 'NOT_RESERVED']);
      expect(await cache.findSlot(saleId, ref.userId)).toEqual({ status: 'NONE' });
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('5');
    });

    it('does nothing for a CONFIRMED entry', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      await cache.markConfirmed(ref);

      const outcome = await cache.releaseReservation(ref);

      expect(outcome).toBe('NOT_RESERVED');
      expect(await cache.findSlot(saleId, ref.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: ref.orderId,
      });
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('4');
    });

    it('does nothing when the reservation is held by another orderId', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      const outcome = await cache.releaseReservation({ ...ref, orderId: randomUUID() });

      expect(outcome).toBe('NOT_RESERVED');
      expect(await cache.findSlot(saleId, ref.userId)).toEqual({
        status: 'RESERVED',
        orderId: ref.orderId,
      });
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('4');
    });
  });
});
