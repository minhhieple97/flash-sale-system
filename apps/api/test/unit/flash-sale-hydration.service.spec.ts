import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { LedgerHydrationResult } from '../../src/modules/sale-ledger';
import {
  buildService,
  confirmedBy,
  EXPLICIT_NEW_SALE,
  NEW_WINDOW,
} from '../support/hydration-service.fixture';

afterEach(() => jest.restoreAllMocks());

describe('FlashSaleHydrationService', () => {
  it('subtracts confirmed orders from total stock, restores batches, and finalizes empty entries', async () => {
    const confirmed = confirmedBy('alice', 'bob', 'carol');
    const { service, restoreConfirmedBatch, restoreLostState } = buildService({ confirmed });

    await service.hydrate();

    expect(restoreConfirmedBatch).toHaveBeenCalledWith('sale-1', confirmed);
    const [state] = restoreLostState.mock.calls[0];
    expect(state.snapshot.remainingStock).toBe(7);
    expect(state.confirmed).toEqual([]);
  });

  it('keeps remaining stock equal to total stock when nothing is confirmed', async () => {
    const { service, restoreConfirmedBatch, restoreLostState } = buildService();

    await service.hydrate();

    expect(restoreConfirmedBatch).not.toHaveBeenCalled();
    expect(restoreLostState.mock.calls[0][0].snapshot.remainingStock).toBe(10);
  });

  it('ensures the product, then the campaign for it, then batches confirmed orders of that sale', async () => {
    const { service, calls } = buildService();

    await service.hydrate();

    expect(calls).toEqual([
      'ensureFeaturedProduct',
      'ensureActiveCampaign:product-1',
      'listConfirmedBatch:sale-1',
    ]);
  });

  it('builds the snapshot from the campaign with dates in milliseconds', async () => {
    const { service, restoreLostState } = buildService();

    await service.hydrate();

    expect(restoreLostState.mock.calls[0][0].snapshot).toEqual({
      saleId: 'sale-1',
      totalStock: 10,
      remainingStock: 10,
      startsAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
      endsAtMs: Date.parse('2030-01-01T01:00:00.000Z'),
    });
  });

  it.each<LedgerHydrationResult>(['HYDRATED', 'ALREADY_PRESENT'])(
    'returns the ledger result %s unchanged',
    async (result) => {
      const { service } = buildService({ hydrateResult: result });

      await expect(service.hydrate()).resolves.toBe(result);
    },
  );

  it('restoreIfLost answers ALREADY_PRESENT without reading PostgreSQL when the ledger is intact', async () => {
    const { service, calls, restoreLostState } = buildService({ isIntact: true });

    const result = await service.restoreIfLost();

    expect(result).toBe('ALREADY_PRESENT');
    expect(calls).toEqual([`isIntact:${ACTIVE_FLASH_SALE_ID}`]);
    expect(restoreLostState).not.toHaveBeenCalled();
  });

  it('restoreIfLost rebuilds from PostgreSQL without seeding or rescheduling when a key is lost', async () => {
    const confirmed = confirmedBy('alice', 'bob');
    const { service, calls, restoreConfirmedBatch, restoreLostState } = buildService({
      isIntact: false,
      confirmed,
      window: NEW_WINDOW,
      explicit: EXPLICIT_NEW_SALE,
    });

    const result = await service.restoreIfLost();

    expect(result).toBe('HYDRATED');
    expect(calls).toEqual([
      `isIntact:${ACTIVE_FLASH_SALE_ID}`,
      'getActiveCampaign',
      'listConfirmedBatch:sale-1',
    ]);
    expect(restoreConfirmedBatch).toHaveBeenCalledWith('sale-1', confirmed);
    expect(restoreLostState.mock.calls[0][0]).toEqual({
      snapshot: expect.objectContaining({ totalStock: 10, remainingStock: 8 }),
      confirmed: [],
    });
  });

  it('walks multiple confirmed batches and finalizes stock using the cumulative total', async () => {
    const page1 = confirmedBy('alice', 'bob');
    const page2 = confirmedBy('carol');
    const { service, listConfirmedBatch, restoreConfirmedBatch, restoreLostState } = buildService();
    const cursor = { createdAt: '2030-01-01T00:00:00.000Z', id: 'order-bob' };
    listConfirmedBatch
      .mockResolvedValueOnce({ entries: page1, nextCursor: cursor })
      .mockResolvedValueOnce({ entries: page2, nextCursor: null });

    await service.hydrate();

    expect(listConfirmedBatch).toHaveBeenCalledTimes(2);
    expect(listConfirmedBatch.mock.calls[1][0].cursor).toEqual(cursor);
    expect(restoreConfirmedBatch.mock.calls).toEqual([
      ['sale-1', page1],
      ['sale-1', page2],
    ]);
    expect(restoreLostState.mock.calls[0][0].snapshot.remainingStock).toBe(7);
  });
});
