import { randomUUID } from 'node:crypto';
import {
  flashSaleConfigKey,
  flashSalePendingKey,
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../support/ledger-keys';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';
import { userIdOf } from '../support/user-id.fixtures';

describe('SaleLedgerRepository', () => {
  let harness: SaleLedgerHarness;
  let redis: SaleLedgerHarness['redis'];
  let ledger: SaleLedgerHarness['ledger'];
  let seedSale: SaleLedgerHarness['seedSale'];
  let reserve: SaleLedgerHarness['reserve'];

  beforeAll(async () => {
    harness = await createSaleLedgerHarness();
    ({ redis, ledger, seedSale, reserve } = harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('findSlot', () => {
    it('returns NONE for a user without an entry', async () => {
      const saleId = await seedSale(5);

      const slot = await ledger.findSlot(saleId, userIdOf('alice'));

      expect(slot).toEqual({ status: 'NONE' });
    });

    it('returns RESERVED with the order id the Lua gatekeeper wrote', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      const slot = await ledger.findSlot(saleId, ref.userId);

      expect(slot).toEqual({ status: 'RESERVED', orderId: ref.orderId });
    });

    it('returns CONFIRMED after confirmReservation', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      await ledger.confirmReservation(ref, ref.orderId);

      const slot = await ledger.findSlot(saleId, ref.userId);

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

      const lookup = ledger.findSlot(saleId, userIdOf('alice'));

      await expect(lookup).rejects.toThrow();
    });
  });

  describe('listPendingReservations', () => {
    it('returns the RESERVED entries from the pending ZSET and omits CONFIRMED ones', async () => {
      const saleId = await seedSale(5);
      const alice = await reserve(saleId, 'alice');
      const bob = await reserve(saleId, 'bob');
      await ledger.confirmReservation(bob, bob.orderId);

      const refs = await ledger.listPendingReservations(saleId);

      expect(refs).toEqual([alice]);
      expect(await redis.zrange(flashSalePendingKey(saleId), 0, -1)).toEqual([alice.userId]);
    });

    it('returns nothing for a sale without pending entries', async () => {
      const refs = await ledger.listPendingReservations(harness.newSaleId());

      expect(refs).toEqual([]);
    });

    it('filters by olderThanMs cutoff and self-prunes stale non-RESERVED ZSET members', async () => {
      const saleId = await seedSale(5);
      const alice = await reserve(saleId, 'alice');
      await redis.zadd(flashSalePendingKey(saleId), 100, 'stale-user');

      const beforeCutoff = await ledger.listPendingReservations(saleId, 500);
      const allPending = await ledger.listPendingReservations(saleId);

      expect(beforeCutoff).toEqual([]);
      expect(allPending).toEqual([alice]);
      expect(await redis.zscore(flashSalePendingKey(saleId), 'stale-user')).toBeNull();
    });
  });

  describe('confirmReservation', () => {
    it('confirms a RESERVED entry and answers CONFIRMED again on a resend', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      const storedOrderId = randomUUID();

      const first = await ledger.confirmReservation(ref, storedOrderId);
      const resend = await ledger.confirmReservation(ref, storedOrderId);

      expect([first, resend]).toEqual(['CONFIRMED', 'CONFIRMED']);
      expect(await ledger.findSlot(saleId, ref.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: storedOrderId,
      });
      expect(await redis.hlen(flashSaleUsersKey(saleId))).toBe(1);
    });

    it('does not resurrect a released reservation', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      await ledger.releaseReservation(ref);

      const outcome = await ledger.confirmReservation(ref, ref.orderId);

      expect(await ledger.findSlot(saleId, ref.userId)).toEqual({ status: 'NONE' });
      expect(outcome).toBe('NOT_RESERVED');
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('5');
    });

    it('answers NOT_RESERVED for an entry held by another orderId and writes nothing', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      const staleOrderId = randomUUID();

      const outcome = await ledger.confirmReservation(
        { ...ref, orderId: staleOrderId },
        staleOrderId,
      );

      expect(await ledger.findSlot(saleId, ref.userId)).toEqual({
        status: 'RESERVED',
        orderId: ref.orderId,
      });
      expect(outcome).toBe('NOT_RESERVED');
    });
  });

  describe('releaseReservation', () => {
    it('releases a RESERVED entry, restores stock, then reports NOT_RESERVED on repeat', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      const first = await ledger.releaseReservation(ref);
      const second = await ledger.releaseReservation(ref);

      expect([first, second]).toEqual(['RELEASED', 'NOT_RESERVED']);
      expect(await ledger.findSlot(saleId, ref.userId)).toEqual({ status: 'NONE' });
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('5');
    });

    it('does nothing for a CONFIRMED entry', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');
      await ledger.confirmReservation(ref, ref.orderId);

      const outcome = await ledger.releaseReservation(ref);

      expect(outcome).toBe('NOT_RESERVED');
      expect(await ledger.findSlot(saleId, ref.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: ref.orderId,
      });
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('4');
    });

    it('does nothing when the reservation is held by another orderId', async () => {
      const saleId = await seedSale(5);
      const ref = await reserve(saleId, 'alice');

      const outcome = await ledger.releaseReservation({ ...ref, orderId: randomUUID() });

      expect(outcome).toBe('NOT_RESERVED');
      expect(await ledger.findSlot(saleId, ref.userId)).toEqual({
        status: 'RESERVED',
        orderId: ref.orderId,
      });
      expect(await redis.get(flashSaleStockKey(saleId))).toBe('4');
    });
  });

  describe('readSlotWithLedgerState', () => {
    it('returns slot and isLedgerIntact=true when config and stock exist', async () => {
      const saleId = await seedSale(5);
      const alice = await reserve(saleId, 'alice');

      const missingUser = await ledger.readSlotWithLedgerState(saleId, userIdOf('bob'));
      const reservedUser = await ledger.readSlotWithLedgerState(saleId, alice.userId);

      expect(missingUser).toEqual({ slot: { status: 'NONE' }, isLedgerIntact: true });
      expect(reservedUser).toEqual({
        slot: { status: 'RESERVED', orderId: alice.orderId },
        isLedgerIntact: true,
      });
    });

    it('returns isLedgerIntact=false when stock or config key is missing', async () => {
      const noStock = await seedSale(5);
      await redis.del(flashSaleStockKey(noStock));
      const noConfig = await seedSale(5);
      await redis.del(flashSaleConfigKey(noConfig));

      const readNoStock = await ledger.readSlotWithLedgerState(noStock, userIdOf('alice'));
      const readNoConfig = await ledger.readSlotWithLedgerState(noConfig, userIdOf('alice'));

      expect(readNoStock).toEqual({ slot: { status: 'NONE' }, isLedgerIntact: false });
      expect(readNoConfig).toEqual({ slot: { status: 'NONE' }, isLedgerIntact: false });
    });
  });
});
