import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import type { PurchaseAttemptResult } from '../../src/modules/checkout/interfaces/checkout.interface';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { deferred } from '../support/deferred';
import { flashSaleStockKey, flashSaleUsersKey } from '../support/ledger-keys';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';
import { waitFor } from '../support/wait-for';

const TOTAL_STOCK = 2;

interface SaleUnits {
  pgRemaining: number;
  pgOrderUsers: string[];
  redisStock: number;
  redisEntries: string[];
}

describe('a persist job that commits after the ledger was restored without it', () => {
  let h: RealSaleHarness;

  beforeAll(async () => {
    h = await createRealSaleHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await h.close();
  });

  async function readUnits(): Promise<SaleUnits> {
    const [sale] = await h.dataSource.query(
      'SELECT remaining_stock FROM flash_sales WHERE id = $1',
      [ACTIVE_FLASH_SALE_ID],
    );
    const orders: { user_id: string }[] = await h.dataSource.query(
      'SELECT user_id FROM orders WHERE flash_sale_id = $1',
      [ACTIVE_FLASH_SALE_ID],
    );
    return {
      pgRemaining: sale.remaining_stock,
      pgOrderUsers: orders.map((order) => order.user_id),
      redisStock: Number(await h.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID))),
      redisEntries: await h.redis.hvals(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID)),
    };
  }

  async function waitForSettled(): Promise<void> {
    await waitFor(
      async () => ({
        jobs: await h.runnableJobCount(),
        reserved: (await readUnits()).redisEntries.filter((e) => e.startsWith('RESERVED:')).length,
      }),
      ({ jobs, reserved }) => jobs === 0 && reserved === 0,
      { timeoutMs: 10_000 },
    );
  }

  async function holdSaleRowLock(): Promise<() => Promise<void>> {
    const runner = h.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM flash_sales WHERE id = $1 FOR UPDATE', [
      ACTIVE_FLASH_SALE_ID,
    ]);
    return async () => {
      await runner.rollbackTransaction();
      await runner.release();
    };
  }

  const waitForPersistBlockedOnLock = (): Promise<number> =>
    waitFor(
      async () => {
        const [row] = await h.dataSource.query(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        );
        return row.waiting as number;
      },
      (waiting) => waiting === 1,
    );

  it('gives every accepted buyer an order and keeps both stores at the total after FLUSHALL', async () => {
    await h.resetService.reset({ totalStock: TOTAL_STOCK, startsOffsetSeconds: -60 });
    const releaseLock = await holdSaleRowLock();
    const accepted: NormalizedUserId[] = [];
    const buy = async (user: string): Promise<PurchaseAttemptResult> => {
      const result = await h.checkout.attemptPurchase(userIdOf(user));
      if (result.outcome === 'RESERVED') accepted.push(userIdOf(user));
      return result;
    };
    await buy('adopt-a');
    await waitForPersistBlockedOnLock();
    await h.redis.flushall();
    await h.maintenance.tick();
    await releaseLock();
    await waitForSettled();

    await buy('adopt-b');
    await buy('adopt-c');
    await waitForSettled();
    await h.maintenance.tick();
    const end = await readUnits();

    const confirmed = end.redisEntries.filter((entry) => entry.startsWith('CONFIRMED:')).length;
    expect({
      acceptedWithoutOrder: accepted.filter((user) => !end.pgOrderUsers.includes(user)),
      redisUnits: end.redisStock + confirmed,
      pgUnits: end.pgRemaining + end.pgOrderUsers.length,
    }).toEqual({ acceptedWithoutOrder: [], redisUnits: TOTAL_STOCK, pgUnits: TOTAL_STOCK });
  }, 30_000);

  it('retries adoption after restoreIfLost finishes when PG commits mid-restore', async () => {
    await h.resetService.reset({ totalStock: TOTAL_STOCK, startsOffsetSeconds: -60 });
    const rawReleaseLock = await holdSaleRowLock();
    let lockReleased = false;
    const releaseLock = async (): Promise<void> => {
      if (lockReleased) return;
      lockReleased = true;
      await rawReleaseLock();
    };
    const allowRestoreFinish = deferred();
    try {
      const buyer = userIdOf('adopt-mid-restore');
      const purchase = await h.checkout.attemptPurchase(buyer);
      if (purchase.outcome !== 'RESERVED')
        throw new Error(`unexpected outcome: ${purchase.outcome}`);
      await waitForPersistBlockedOnLock();
      await h.deleteSaleRedisKeys();

      const restoreStarted = deferred();
      const origRestoreLostState = h.ledger.restoreLostState.bind(h.ledger);
      jest.spyOn(h.ledger, 'restoreLostState').mockImplementationOnce(async (state) => {
        restoreStarted.resolve();
        await allowRestoreFinish.promise;
        return origRestoreLostState(state);
      });

      const tick = h.maintenance.tick();
      await restoreStarted.promise;
      await releaseLock();
      await waitFor(
        () => h.queue.getJobState(purchase.orderId),
        (state) => state === 'delayed',
      );
      allowRestoreFinish.resolve();
      await tick;
      await waitForSettled();

      const end = await readUnits();
      const confirmed = end.redisEntries.filter((entry) => entry.startsWith('CONFIRMED:')).length;
      expect({
        pgOrderUsers: end.pgOrderUsers,
        redisUnits: end.redisStock + confirmed,
        pgUnits: end.pgRemaining + end.pgOrderUsers.length,
      }).toEqual({ pgOrderUsers: [buyer], redisUnits: TOTAL_STOCK, pgUnits: TOTAL_STOCK });
    } finally {
      allowRestoreFinish.resolve();
      await releaseLock();
    }
  }, 30_000);
});
