import { Logger } from '@nestjs/common';
import type { ClockService } from '../../src/common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type {
  FlashSaleCampaign,
  SaleState,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSalesRepository } from '../../src/modules/flash-sales/repositories/flash-sales.repository';
import { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type {
  FlashSaleSnapshot,
  SaleLedgerRepository,
  SnapshotRead,
} from '../../src/modules/sale-ledger';
import { buildSnapshot, END_MS, START_MS } from '../support/flash-sale.fixtures';

function buildService(
  read: SnapshotRead,
  now: number,
  flashSalesRepository?: FlashSalesRepository,
) {
  const clock = { now, nowMs: (): number => clock.now };
  const readSnapshot = jest.fn<Promise<SnapshotRead>, [string]>();
  readSnapshot.mockResolvedValue(read);
  const cache = { readSnapshot } as unknown as SaleLedgerRepository;
  const service = new FlashSalesService(
    cache,
    clock as unknown as ClockService,
    flashSalesRepository,
  );
  return { service, clock, readSnapshot };
}

const CAMPAIGN: FlashSaleCampaign = {
  id: ACTIVE_FLASH_SALE_ID,
  productId: 'product-1',
  totalStock: 10,
  remainingStock: 10,
  startsAt: new Date(START_MS),
  endsAt: new Date(END_MS),
};

const found = (snapshot: FlashSaleSnapshot): SnapshotRead => ({ status: 'FOUND', snapshot });

describe('FlashSalesService sale state', () => {
  const cases: { name: string; now: number; remainingStock: number; expected: SaleState }[] = [
    {
      name: 'one ms before the start is UPCOMING',
      now: START_MS - 1,
      remainingStock: 5,
      expected: 'UPCOMING',
    },
    {
      name: 'exactly at the start is ACTIVE',
      now: START_MS,
      remainingStock: 5,
      expected: 'ACTIVE',
    },
    { name: 'exactly at the end is ACTIVE', now: END_MS, remainingStock: 5, expected: 'ACTIVE' },
    {
      name: 'one ms after the end is ENDED',
      now: END_MS + 1,
      remainingStock: 5,
      expected: 'ENDED',
    },
    {
      name: 'zero stock inside the window is SOLD_OUT',
      now: START_MS + 1,
      remainingStock: 0,
      expected: 'SOLD_OUT',
    },
    {
      name: 'zero stock before the start is UPCOMING',
      now: START_MS - 1,
      remainingStock: 0,
      expected: 'UPCOMING',
    },
    {
      name: 'zero stock after the end is ENDED',
      now: END_MS + 1,
      remainingStock: 0,
      expected: 'ENDED',
    },
  ];

  it.each(cases)('$name', async ({ now, remainingStock, expected }) => {
    const { service } = buildService(found(buildSnapshot({ remainingStock })), now);

    const status = await service.getCurrentStatus();

    expect(status.saleState).toBe(expected);
  });

  it('reports the clock as serverTimeMs and keeps the snapshot fields', async () => {
    const { service } = buildService(found(buildSnapshot()), START_MS + 42);

    const status = await service.getCurrentStatus();

    expect(status).toEqual({
      ...buildSnapshot(),
      saleState: 'ACTIVE',
      serverTimeMs: START_MS + 42,
    });
  });

  it('reads the active flash sale id', async () => {
    const { service, readSnapshot } = buildService(found(buildSnapshot()), START_MS);

    await service.getCurrentStatus();

    expect(readSnapshot).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID);
  });

  it('rejects with TEMPORARY_FAILURE (503) while the stock key is lost', async () => {
    const { service } = buildService({ status: 'STOCK_MISSING' }, START_MS);

    await expect(service.getCurrentStatus()).rejects.toMatchObject({
      status: 503,
      response: { code: 'TEMPORARY_FAILURE' },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects with FLASH_SALE_NOT_FOUND when no snapshot exists and no repository is injected', async () => {
    const { service } = buildService({ status: 'NOT_CONFIGURED' }, START_MS);

    await expect(service.getCurrentStatus()).rejects.toMatchObject({
      response: { code: 'FLASH_SALE_NOT_FOUND' },
    });
  });

  it('rejects with TEMPORARY_FAILURE (503) when Redis is unconfigured but the campaign exists in PG', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const findById = jest
      .fn<Promise<FlashSaleCampaign | null>, [string]>()
      .mockResolvedValue(CAMPAIGN);
    const { service } = buildService({ status: 'NOT_CONFIGURED' }, START_MS, {
      findById,
    } as unknown as FlashSalesRepository);

    await expect(service.getCurrentStatus()).rejects.toMatchObject({
      status: 503,
      response: { code: 'TEMPORARY_FAILURE' },
    });
    expect(findById).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID);
  });

  it('rejects with FLASH_SALE_NOT_FOUND (404) when Redis is unconfigured and PG has no campaign', async () => {
    const findById = jest.fn<Promise<FlashSaleCampaign | null>, [string]>().mockResolvedValue(null);
    const { service } = buildService({ status: 'NOT_CONFIGURED' }, START_MS, {
      findById,
    } as unknown as FlashSalesRepository);

    await expect(service.getCurrentStatus()).rejects.toMatchObject({
      status: 404,
      response: { code: 'FLASH_SALE_NOT_FOUND' },
    });
  });

  it('rejects with TEMPORARY_FAILURE (503) when Redis is unconfigured and PG is unavailable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const dbOutage = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const findById = jest
      .fn<Promise<FlashSaleCampaign | null>, [string]>()
      .mockRejectedValue(dbOutage);
    const { service } = buildService({ status: 'NOT_CONFIGURED' }, START_MS, {
      findById,
    } as unknown as FlashSalesRepository);

    await expect(service.getCurrentStatus()).rejects.toMatchObject({
      status: 503,
      response: { code: 'TEMPORARY_FAILURE' },
    });
  });

  it('rethrows non-database errors from PG campaign lookup when Redis is unconfigured', async () => {
    const findById = jest
      .fn<Promise<FlashSaleCampaign | null>, [string]>()
      .mockRejectedValue(new TypeError('unexpected bug'));
    const { service } = buildService({ status: 'NOT_CONFIGURED' }, START_MS, {
      findById,
    } as unknown as FlashSalesRepository);

    await expect(service.getCurrentStatus()).rejects.toThrow('unexpected bug');
  });
});
