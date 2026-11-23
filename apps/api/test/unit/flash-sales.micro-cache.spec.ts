import { Logger } from '@nestjs/common';
import type { ClockService } from '../../src/common/providers/clock.service';
import { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type {
  FlashSaleSnapshot,
  SaleLedgerRepository,
  SnapshotRead,
} from '../../src/modules/sale-ledger';
import { buildSnapshot, START_MS } from '../support/flash-sale.fixtures';

const found = (snapshot: FlashSaleSnapshot): SnapshotRead => ({ status: 'FOUND', snapshot });

describe('FlashSalesService micro-cache', () => {
  let now: number;
  let readSnapshot: jest.Mock<Promise<SnapshotRead>, [string]>;
  let service: FlashSalesService;

  beforeEach(() => {
    now = START_MS + 1000;
    readSnapshot = jest.fn<Promise<SnapshotRead>, [string]>();
    readSnapshot.mockResolvedValue(found(buildSnapshot()));
    const clock = { nowMs: (): number => now } as unknown as ClockService;
    const cache = { readSnapshot } as unknown as SaleLedgerRepository;
    service = new FlashSalesService(cache, clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves a second call 199 ms later from the cache', async () => {
    await service.getCurrentStatus();
    now += 199;

    await service.getCurrentStatus();

    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('reads again once the 200 ms TTL has elapsed', async () => {
    await service.getCurrentStatus();
    now += 200;

    await service.getCurrentStatus();

    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('shares one read between concurrent calls on a cold cache', async () => {
    await Promise.all([service.getCurrentStatus(), service.getCurrentStatus()]);

    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('forces the next call to read after invalidateCache', async () => {
    await service.getCurrentStatus();

    service.invalidateCache();
    await service.getCurrentStatus();

    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not let an in-flight read repopulate the cache after invalidateCache', async () => {
    let release: (value: SnapshotRead) => void = () => undefined;
    readSnapshot.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const inFlight = service.getCurrentStatus();

    service.invalidateCache();
    release(found(buildSnapshot()));
    await inFlight;
    await service.getCurrentStatus();

    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('flips UPCOMING to ACTIVE inside the TTL without a second read', async () => {
    now = START_MS - 1;
    const before = await service.getCurrentStatus();
    now += 1;

    const after = await service.getCurrentStatus();

    expect([before.saleState, after.saleState]).toEqual(['UPCOMING', 'ACTIVE']);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected read', async () => {
    readSnapshot.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.getCurrentStatus()).rejects.toThrow('redis down');

    await expect(service.getCurrentStatus()).resolves.toMatchObject({ saleState: 'ACTIVE' });

    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it.each<SnapshotRead>([{ status: 'STOCK_MISSING' }, { status: 'NOT_CONFIGURED' }])(
    'does not cache negative %s snapshot reads',
    async (negativeRead) => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      readSnapshot.mockResolvedValueOnce(negativeRead);

      await expect(service.getCurrentStatus()).rejects.toThrow();
      await expect(service.getCurrentStatus()).resolves.toMatchObject({ saleState: 'ACTIVE' });

      expect(readSnapshot).toHaveBeenCalledTimes(2);
    },
  );
});
