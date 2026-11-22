import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';
import { expectLedgerConverged } from '../support/ledger-convergence';
import { flashSaleStockKey, flashSaleUsersKey } from '../support/ledger-keys';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';
import { waitFor } from '../support/wait-for';

const OPEN_WINDOW = { startsOffsetSeconds: -60 };

describe('LedgerMaintenanceService on the real stack', () => {
  let h: RealSaleHarness;
  let totalStock = 0;

  async function resetTo(units: number): Promise<void> {
    totalStock = units;
    await h.resetService.reset({ totalStock: units, ...OPEN_WINDOW });
  }

  const reservedEntries = async (): Promise<string[]> =>
    (await h.redis.hvals(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID))).filter((entry) =>
      entry.startsWith('RESERVED:'),
    );

  beforeAll(async () => {
    h = await createRealSaleHarness();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await expectLedgerConverged(h.moduleRef, { saleId: ACTIVE_FLASH_SALE_ID, totalStock });
  });

  afterAll(async () => {
    await h.close();
  });

  it('heals reservations left by a reset that failed after the queue drain within two ticks', async () => {
    await resetTo(6);
    await h.queue.pause();
    for (let buyer = 0; buyer < 5; buyer += 1) {
      const attempt = await h.checkout.attemptPurchase(userIdOf(`rf-${buyer}`));
      expect(attempt.outcome).toBe('RESERVED');
    }
    jest
      .spyOn(h.moduleRef.get(FlashSaleCampaignService, { strict: false }), 'rescheduleCampaign')
      .mockRejectedValueOnce(new Error('pg fault'));
    await expect(h.resetService.reset({ totalStock: 6, ...OPEN_WINDOW })).rejects.toThrow(
      'pg fault',
    );

    await h.maintenance.tick();
    await h.maintenance.tick();

    expect((await reservedEntries()).length).toBe(0);
    expect(await h.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID))).toBe('6');
  });

  it('serves purchases and the status again after FLUSHALL once a tick ran', async () => {
    await resetTo(2);
    const dave = userIdOf('flush-dave');
    await h.checkout.attemptPurchase(dave);
    await waitFor(
      () => h.ledger.findSlot(ACTIVE_FLASH_SALE_ID, dave),
      (slot) => slot.status === 'CONFIRMED',
    );
    await h.redis.flushall();

    const tick = await h.maintenance.tick();
    const repeat = await h.checkout.attemptPurchase(dave);
    const erin = await h.checkout.attemptPurchase(userIdOf('flush-erin'));
    const frank = await h.checkout.attemptPurchase(userIdOf('flush-frank'));
    const status = await h.flashSales.getCurrentStatus();

    expect(tick).toMatchObject({ status: 'RAN', hydration: 'HYDRATED' });
    expect([repeat.outcome, erin.outcome, frank.outcome]).toEqual([
      'ALREADY_PURCHASED',
      'RESERVED',
      'SOLD_OUT',
    ]);
    expect(status).toMatchObject({
      saleId: ACTIVE_FLASH_SALE_ID,
      totalStock: 2,
      remainingStock: 0,
    });
  });
});
