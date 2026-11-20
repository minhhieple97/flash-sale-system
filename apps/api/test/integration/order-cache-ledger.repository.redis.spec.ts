import { randomUUID } from 'node:crypto';
import { flashSaleUsersKey } from '../../src/infrastructure/redis/redis.constants';
import { buildSnapshot } from '../support/flash-sale.fixtures';
import { createOrderCacheHarness, type OrderCacheHarness } from '../support/order-cache.harness';
import { userIdOf } from '../support/user-id.fixtures';

describe('OrderCacheRepository ledger writes', () => {
  let harness: OrderCacheHarness;
  let redis: OrderCacheHarness['redis'];
  let cache: OrderCacheHarness['cache'];
  let snapshots: OrderCacheHarness['snapshots'];
  let seedSale: OrderCacheHarness['seedSale'];
  let reserve: OrderCacheHarness['reserve'];
  let newSaleId: OrderCacheHarness['newSaleId'];
  let stateOf: OrderCacheHarness['stateOf'];

  beforeAll(async () => {
    harness = await createOrderCacheHarness();
    ({ redis, cache, snapshots, seedSale, reserve, newSaleId, stateOf } = harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('hydrateIfAbsent', () => {
    it('writes config, stock and CONFIRMED users when the sale is absent', async () => {
      const saleId = newSaleId();
      const alice = { userId: userIdOf('alice'), orderId: randomUUID() };
      const state = stateOf(saleId, {
        snapshot: buildSnapshot({ saleId, remainingStock: 7 }),
        confirmed: [alice],
      });

      const result = await cache.hydrateIfAbsent(state);

      expect(result).toBe('HYDRATED');
      expect(await snapshots.readSnapshot(saleId)).toEqual(state.snapshot);
      expect(await cache.findSlot(saleId, alice.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: alice.orderId,
      });
    });

    it('hydrates a sale without confirmed users', async () => {
      const saleId = newSaleId();

      const result = await cache.hydrateIfAbsent(stateOf(saleId));

      expect(result).toBe('HYDRATED');
      expect(await redis.exists(flashSaleUsersKey(saleId))).toBe(0);
    });

    it('returns ALREADY_PRESENT and changes nothing when the config already exists', async () => {
      const saleId = newSaleId();
      const original = stateOf(saleId);
      await cache.hydrateIfAbsent(original);
      const other = stateOf(saleId, {
        snapshot: buildSnapshot({ saleId, remainingStock: 1, totalStock: 99 }),
        confirmed: [{ userId: userIdOf('bob'), orderId: randomUUID() }],
      });

      const result = await cache.hydrateIfAbsent(other);

      expect(result).toBe('ALREADY_PRESENT');
      expect(await snapshots.readSnapshot(saleId)).toEqual(original.snapshot);
      expect(await cache.findSlot(saleId, userIdOf('bob'))).toEqual({ status: 'NONE' });
    });
  });

  describe('replaceState', () => {
    it('overwrites config and stock and removes pre-existing reservations', async () => {
      const saleId = await seedSale(5);
      const stale = await reserve(saleId, 'alice');
      const confirmed = { userId: userIdOf('bob'), orderId: randomUUID() };
      const state = stateOf(saleId, {
        snapshot: buildSnapshot({ saleId, remainingStock: 9, totalStock: 9 }),
        confirmed: [confirmed],
      });

      await cache.replaceState(state);

      expect(await snapshots.readSnapshot(saleId)).toEqual(state.snapshot);
      expect(await cache.findSlot(saleId, stale.userId)).toEqual({ status: 'NONE' });
      expect(await cache.findSlot(saleId, confirmed.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: confirmed.orderId,
      });
    });

    it('clears every entry when the new state has no confirmed users', async () => {
      const saleId = await seedSale(5);
      await reserve(saleId, 'alice');

      await cache.replaceState(stateOf(saleId));

      expect(await redis.exists(flashSaleUsersKey(saleId))).toBe(0);
    });
  });
});
