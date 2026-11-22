import {
  buildService,
  CAMPAIGN,
  confirmedBy,
  EXPLICIT_NEW_SALE,
  NEW_WINDOW,
  STORED_WINDOW,
} from '../support/hydration-service.fixture';

afterEach(() => jest.restoreAllMocks());

describe('FlashSaleHydrationService configured sale window', () => {
  it('reschedules to the configured window when no order and no ledger entry exist', async () => {
    const { service, rescheduleCampaign, replaceState, restoreLostState } = buildService({
      window: NEW_WINDOW,
      explicit: EXPLICIT_NEW_SALE,
    });

    const result = await service.hydrate();

    expect(rescheduleCampaign).toHaveBeenCalledWith({ saleId: 'sale-1', ...NEW_WINDOW });
    expect(replaceState.mock.calls[0][0]).toMatchObject({
      snapshot: { totalStock: 3, remainingStock: 3, startsAtMs: NEW_WINDOW.startsAtMs },
      confirmed: [],
    });
    expect(restoreLostState).not.toHaveBeenCalled();
    expect(result).toBe('HYDRATED');
  });

  it('keeps the stored window when no SALE_* variable is set', async () => {
    const { service, rescheduleCampaign } = buildService({ window: NEW_WINDOW });

    await service.hydrate();

    expect(rescheduleCampaign).not.toHaveBeenCalled();
  });

  it('keeps the stored window and warns when a confirmed order exists without listing rows', async () => {
    const { service, hasConfirmedOrders, listConfirmedBatch, rescheduleCampaign, warn } =
      buildService({
        window: NEW_WINDOW,
        explicit: EXPLICIT_NEW_SALE,
        confirmed: confirmedBy('alice'),
      });

    await service.hydrate();

    expect(hasConfirmedOrders).toHaveBeenCalledWith('sale-1');
    expect(listConfirmedBatch).toHaveBeenCalledTimes(1);
    expect(rescheduleCampaign).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored window and warns when a ledger entry exists', async () => {
    const { service, rescheduleCampaign, warn } = buildService({
      window: NEW_WINDOW,
      explicit: EXPLICIT_NEW_SALE,
      ledgerEntries: 1,
    });

    await service.hydrate();

    expect(rescheduleCampaign).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does nothing and stays quiet when the stored window already matches', async () => {
    const { service, rescheduleCampaign, warn } = buildService({
      explicit: { window: STORED_WINDOW, totalStock: STORED_WINDOW.totalStock },
    });

    await service.hydrate();

    expect(rescheduleCampaign).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the stored window on a restart when only an unchanged stock is configured', async () => {
    const { service, rescheduleCampaign } = buildService({
      window: NEW_WINDOW,
      explicit: { totalStock: CAMPAIGN.totalStock },
    });

    await service.hydrate();

    expect(rescheduleCampaign).not.toHaveBeenCalled();
  });

  it('rewrites only the stock, keeping the stored window, when only the stock is configured', async () => {
    const { service, rescheduleCampaign } = buildService({
      window: NEW_WINDOW,
      explicit: { totalStock: 3 },
    });

    await service.hydrate();

    expect(rescheduleCampaign).toHaveBeenCalledWith({
      saleId: 'sale-1',
      ...STORED_WINDOW,
      totalStock: 3,
    });
  });

  it('rewrites only the window, keeping the stored stock, when only the window is configured', async () => {
    const { service, rescheduleCampaign } = buildService({
      window: NEW_WINDOW,
      explicit: { window: EXPLICIT_NEW_SALE.window },
    });

    await service.hydrate();

    expect(rescheduleCampaign).toHaveBeenCalledWith({
      saleId: 'sale-1',
      ...NEW_WINDOW,
      totalStock: CAMPAIGN.totalStock,
    });
  });
});
