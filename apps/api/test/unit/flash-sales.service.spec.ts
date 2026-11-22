import type { ClockService } from '../../src/common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { SaleState } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type {
  FlashSaleSnapshot,
  SaleLedgerRepository,
  SnapshotRead,
} from '../../src/modules/sale-ledger';
import { buildSnapshot, END_MS, START_MS } from '../support/flash-sale.fixtures';

function buildService(read: SnapshotRead, now: number) {
  const clock = { now, nowMs: (): number => clock.now };
  const readSnapshot = jest.fn<Promise<SnapshotRead>, [string]>();
  readSnapshot.mockResolvedValue(read);
  const cache = { readSnapshot } as unknown as SaleLedgerRepository;
  const service = new FlashSalesService(cache, clock as unknown as ClockService);
  return { service, clock, readSnapshot };
}

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

  it('rejects with FLASH_SALE_NOT_FOUND when no snapshot exists', async () => {
    const { service } = buildService({ status: 'NOT_CONFIGURED' }, START_MS);

    await expect(service.getCurrentStatus()).rejects.toMatchObject({
      response: { code: 'FLASH_SALE_NOT_FOUND' },
    });
  });
});
