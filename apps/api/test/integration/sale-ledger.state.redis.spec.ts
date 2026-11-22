import { randomUUID } from 'node:crypto';
import type {
  ConfirmedReservation,
  FlashSaleSnapshot,
  ReservationRef,
  SaleLedgerState,
} from '../../src/modules/sale-ledger';
import { buildSnapshot } from '../support/flash-sale.fixtures';
import { flashSaleConfigKey, flashSaleStockKey, flashSaleUsersKey } from '../support/ledger-keys';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';
import { userIdOf } from '../support/user-id.fixtures';

const TOTAL = 10;

function makeConfirmed(count: number): ConfirmedReservation[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: userIdOf(`bulk-${index}`),
    orderId: randomUUID(),
  }));
}

describe('SaleLedgerRepository whole-sale state', () => {
  let harness: SaleLedgerHarness;
  let redis: SaleLedgerHarness['redis'];
  let ledger: SaleLedgerHarness['ledger'];
  let seedSale: SaleLedgerHarness['seedSale'];
  let reserve: SaleLedgerHarness['reserve'];
  let newSaleId: SaleLedgerHarness['newSaleId'];
  let stateOf: SaleLedgerHarness['stateOf'];

  beforeAll(async () => {
    harness = await createSaleLedgerHarness();
    ({ redis, ledger, seedSale, reserve, newSaleId, stateOf } = harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function liveSale(): Promise<{ state: SaleLedgerState; reserved: ReservationRef[] }> {
    const saleId = newSaleId();
    const confirmed = ['carol', 'dave', 'erin'].map((user) => ({
      userId: userIdOf(user),
      orderId: randomUUID(),
    }));
    const state = stateOf(saleId, {
      snapshot: buildSnapshot({ saleId, totalStock: TOTAL, remainingStock: TOTAL - 3 }),
      confirmed,
    });
    await ledger.replaceState(state);
    const reserved = [await reserve(saleId, 'alice'), await reserve(saleId, 'bob')];
    return { state, reserved };
  }

  async function snapshotOf(saleId: string): Promise<FlashSaleSnapshot | null> {
    const read = await ledger.readSnapshot(saleId);
    return read.status === 'FOUND' ? read.snapshot : null;
  }

  const usersOf = (saleId: string): Promise<Record<string, string>> =>
    redis.hgetall(flashSaleUsersKey(saleId));

  describe('restoreLostState', () => {
    it('rebuilds a lost stock key as total minus every held entry and keeps RESERVED entries', async () => {
      const { state, reserved } = await liveSale();
      const saleId = state.snapshot.saleId;
      const usersBefore = await usersOf(saleId);
      await redis.del(flashSaleStockKey(saleId));

      const result = await ledger.restoreLostState(state);

      expect(result).toBe('HYDRATED');
      expect(await redis.get(flashSaleStockKey(saleId))).toBe(String(TOTAL - 5));
      expect(await usersOf(saleId)).toEqual(usersBefore);
      expect(await ledger.findSlot(saleId, reserved[0].userId)).toEqual({
        status: 'RESERVED',
        orderId: reserved[0].orderId,
      });
    });

    it('rebuilds a missing config hash without touching stock or users', async () => {
      const { state } = await liveSale();
      const saleId = state.snapshot.saleId;
      const usersBefore = await usersOf(saleId);
      await redis.del(flashSaleConfigKey(saleId));

      const result = await ledger.restoreLostState(state);

      expect(result).toBe('HYDRATED');
      expect(await snapshotOf(saleId)).toEqual({
        ...state.snapshot,
        remainingStock: TOTAL - 5,
      });
      expect(await usersOf(saleId)).toEqual(usersBefore);
    });

    it('writes config, CONFIRMED entries and stock when all three keys are gone', async () => {
      const saleId = newSaleId();
      const alice = { userId: userIdOf('alice'), orderId: randomUUID() };
      const state = stateOf(saleId, {
        snapshot: buildSnapshot({ saleId, totalStock: 8, remainingStock: 7 }),
        confirmed: [alice],
      });

      const result = await ledger.restoreLostState(state);

      expect(result).toBe('HYDRATED');
      expect(await snapshotOf(saleId)).toEqual(state.snapshot);
      expect(await ledger.findSlot(saleId, alice.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: alice.orderId,
      });
    });

    it('creates no users hash for a sale without confirmed orders', async () => {
      const saleId = newSaleId();

      const result = await ledger.restoreLostState(stateOf(saleId));

      expect(result).toBe('HYDRATED');
      expect(await redis.exists(flashSaleUsersKey(saleId))).toBe(0);
    });

    it('returns ALREADY_PRESENT and writes nothing when config, stock and entries exist', async () => {
      const { state } = await liveSale();
      const saleId = state.snapshot.saleId;
      const before = {
        snapshot: await snapshotOf(saleId),
        users: await usersOf(saleId),
      };
      const drifted = {
        ...state,
        snapshot: buildSnapshot({ saleId, totalStock: 99, remainingStock: 99 }),
      };

      const result = await ledger.restoreLostState(drifted);

      expect(result).toBe('ALREADY_PRESENT');
      expect(await snapshotOf(saleId)).toEqual(before.snapshot);
      expect(await usersOf(saleId)).toEqual(before.users);
    });

    it('restores 2,500 confirmed entries in chunks and computes remaining stock atomically', async () => {
      const saleId = newSaleId();
      const confirmed = makeConfirmed(2_500);
      const state = stateOf(saleId, {
        snapshot: buildSnapshot({ saleId, totalStock: 3_000, remainingStock: 500 }),
        confirmed,
      });

      const result = await ledger.restoreLostState(state);

      expect(result).toBe('HYDRATED');
      expect(await redis.hlen(flashSaleUsersKey(saleId))).toBe(2_500);
      expect(await snapshotOf(saleId)).toEqual(state.snapshot);
      expect(await ledger.findSlot(saleId, confirmed[2_499].userId)).toEqual({
        status: 'CONFIRMED',
        orderId: confirmed[2_499].orderId,
      });
    });
  });

  describe('restoreConfirmedBatch', () => {
    it('writes confirmed entries without overwriting an existing RESERVED slot', async () => {
      const saleId = await seedSale(5);
      const reserved = await reserve(saleId, 'alice');
      const confirmed = [{ userId: reserved.userId, orderId: randomUUID() }, ...makeConfirmed(2)];

      const firstWrote = await ledger.restoreConfirmedBatch(saleId, confirmed);
      const secondWrote = await ledger.restoreConfirmedBatch(saleId, confirmed);

      expect([firstWrote, secondWrote]).toEqual([true, false]);
      expect(await ledger.findSlot(saleId, reserved.userId)).toEqual({
        status: 'RESERVED',
        orderId: reserved.orderId,
      });
      expect(await redis.hlen(flashSaleUsersKey(saleId))).toBe(3);
    });
  });

  describe('isIntact', () => {
    it('is true only while both the config hash and the stock key exist', async () => {
      const intact = (await liveSale()).state.snapshot.saleId;
      const noStock = (await liveSale()).state.snapshot.saleId;
      const noConfig = (await liveSale()).state.snapshot.saleId;
      await redis.del(flashSaleStockKey(noStock));
      await redis.del(flashSaleConfigKey(noConfig));

      const verdicts = await Promise.all(
        [intact, noStock, noConfig].map((id) => ledger.isIntact(id)),
      );

      expect(verdicts).toEqual([true, false, false]);
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

      await ledger.replaceState(state);

      expect(await snapshotOf(saleId)).toEqual(state.snapshot);
      expect(await ledger.findSlot(saleId, stale.userId)).toEqual({ status: 'NONE' });
      expect(await ledger.findSlot(saleId, confirmed.userId)).toEqual({
        status: 'CONFIRMED',
        orderId: confirmed.orderId,
      });
    });

    it('clears every entry when the new state has no confirmed users', async () => {
      const saleId = await seedSale(5);
      await reserve(saleId, 'alice');

      await ledger.replaceState(stateOf(saleId));

      expect(await redis.exists(flashSaleUsersKey(saleId))).toBe(0);
    });

    it('chunks 2,500 confirmed entries inside MULTI', async () => {
      const saleId = newSaleId();
      const confirmed = makeConfirmed(2_500);
      const state = stateOf(saleId, {
        snapshot: buildSnapshot({ saleId, totalStock: 3_000, remainingStock: 500 }),
        confirmed,
      });

      await ledger.replaceState(state);

      expect(await redis.hlen(flashSaleUsersKey(saleId))).toBe(2_500);
      expect(await snapshotOf(saleId)).toEqual(state.snapshot);
    });
  });
});
