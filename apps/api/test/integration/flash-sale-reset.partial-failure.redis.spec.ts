import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import {
  SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../support/ledger-keys';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';
import { waitFor } from '../support/wait-for';

const OPEN_WINDOW = { startsOffsetSeconds: -60 };

interface SaleTotals {
  pgTotal: number;
  pgUnits: number;
  redisTotal: number;
  redisUnits: number;
}

describe('FlashSaleResetService failing after it started', () => {
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

  async function readTotals(): Promise<SaleTotals> {
    const [sale] = await h.dataSource.query(
      'SELECT total_stock, remaining_stock FROM flash_sales WHERE id = $1',
      [ACTIVE_FLASH_SALE_ID],
    );
    const [orders] = await h.dataSource.query(
      'SELECT count(*)::int AS count FROM orders WHERE flash_sale_id = $1',
      [ACTIVE_FLASH_SALE_ID],
    );
    const redisTotal = await h.redis.hget(flashSaleConfigKey(ACTIVE_FLASH_SALE_ID), F.totalStock);
    const redisStock = await h.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID));
    const entries = await h.redis.hlen(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID));
    return {
      pgTotal: sale.total_stock,
      pgUnits: sale.remaining_stock + orders.count,
      redisTotal: Number(redisTotal),
      redisUnits: Number(redisStock) + entries,
    };
  }

  async function seedTwoOrders(totalStock: number): Promise<void> {
    await h.resetService.reset({ totalStock, ...OPEN_WINDOW });
    for (const user of ['pf-a', 'pf-b']) await h.checkout.attemptPurchase(userIdOf(user));
    await waitFor(
      async () => (await h.redis.hvals(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID))).join(),
      (entries) => entries.split('CONFIRMED:').length === 3,
    );
  }

  const sameSale = (total: number): SaleTotals => ({
    pgTotal: total,
    pgUnits: total,
    redisTotal: total,
    redisUnits: total,
  });

  it('completes the reset on the next tick when the Redis replace failed after PostgreSQL committed', async () => {
    await seedTwoOrders(5);
    jest.spyOn(h.ledger, 'replaceState').mockRejectedValueOnce(new Error('redis blip'));

    const reset = h.resetService.reset({ totalStock: 2, ...OPEN_WINDOW });
    await expect(reset).rejects.toThrow('redis blip');
    await h.maintenance.tick();

    expect(await readTotals()).toEqual(sameSale(2));
  });

  it('keeps the old sale whole in PostgreSQL when its rewrite fails', async () => {
    await seedTwoOrders(5);

    const reset = h.resetService.reset({ totalStock: 2, ...OPEN_WINDOW, durationSeconds: 0 });
    await expect(reset).rejects.toThrow('ck_flash_sales_window');
    await h.maintenance.tick();

    expect(await readTotals()).toEqual(sameSale(5));
  });

  it('heals split api+worker partial failure via restoreIfLost when replaceState fails after PG commits', async () => {
    await seedTwoOrders(5);
    jest.spyOn(h.ledger, 'replaceState').mockRejectedValueOnce(new Error('redis blip'));

    await expect(h.resetService.reset({ totalStock: 2, ...OPEN_WINDOW })).rejects.toThrow(
      'redis blip',
    );
    expect(await h.ledger.isIntact(ACTIVE_FLASH_SALE_ID)).toBe(false);

    jest.spyOn(h.resetService, 'completePendingReset').mockResolvedValueOnce('NONE');
    await h.maintenance.tick();

    expect(await readTotals()).toEqual(sameSale(2));
  });
});
