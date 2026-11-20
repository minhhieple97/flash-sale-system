import type { ClockService } from '../../src/common/providers/clock.service';
import type { FlashSaleSnapshot } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSaleCacheRepository } from '../../src/modules/flash-sales/repositories/flash-sale-cache.repository';
import { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import { buildSnapshot, START_MS } from '../support/flash-sale.fixtures';

describe('FlashSalesService micro-cache', () => {
  let now: number;
  let readSnapshot: jest.Mock<Promise<FlashSaleSnapshot | null>, [string]>;
  let service: FlashSalesService;

  beforeEach(() => {
    now = START_MS + 1000;
    readSnapshot = jest.fn<Promise<FlashSaleSnapshot | null>, [string]>();
    readSnapshot.mockResolvedValue(buildSnapshot());
    const clock = { nowMs: (): number => now } as unknown as ClockService;
    const cache = { readSnapshot } as unknown as FlashSaleCacheRepository;
    service = new FlashSalesService(cache, clock);
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
    let release: (value: FlashSaleSnapshot) => void = () => undefined;
    readSnapshot.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const inFlight = service.getCurrentStatus();

    service.invalidateCache();
    release(buildSnapshot());
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
});
