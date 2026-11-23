import { Logger, NotFoundException } from '@nestjs/common';
import type { ClockService } from '../../src/common/providers/clock.service';
import {
  FEATURED_PRODUCT_CACHE_TTL_MS,
  FEATURED_PRODUCT_ID,
  FEATURED_PRODUCT_SEED,
  STALE_PRODUCT_FALLBACK_TTL_MS,
} from '../../src/modules/products/constants/products.constants';
import type { Product } from '../../src/modules/products/interfaces/product.interface';
import type { ProductsRepository } from '../../src/modules/products/repositories/products.repository';
import { ProductsService } from '../../src/modules/products/services/products.service';

const PRODUCT: Product = {
  id: FEATURED_PRODUCT_ID,
  sku: 'sku-1',
  name: 'Phone',
  description: 'A phone',
  originalPriceCents: 1000,
  salePriceCents: 500,
  imageUrl: null,
};

function buildService(
  found: Product | null,
  nowRef: { now: number } = { now: 1_000 },
): {
  service: ProductsService;
  findById: jest.Mock<Promise<Product | null>, [string]>;
} {
  const findById = jest.fn<Promise<Product | null>, [string]>().mockResolvedValue(found);
  const repository = { findById } as unknown as ProductsRepository;
  const clock = { nowMs: (): number => nowRef.now } as unknown as ClockService;
  return { service: new ProductsService(repository, clock), findById };
}

afterEach(() => jest.restoreAllMocks());

describe('ProductsService', () => {
  it('returns the featured product from the repository', async () => {
    const { service, findById } = buildService(PRODUCT);

    const product = await service.getFeaturedProduct();

    expect(product).toBe(PRODUCT);
    expect(findById).toHaveBeenCalledWith(FEATURED_PRODUCT_ID);
  });

  it('rejects with PRODUCT_NOT_FOUND when the repository finds nothing', async () => {
    const { service } = buildService(null);

    const result = service.getFeaturedProduct();

    await expect(result).rejects.toBeInstanceOf(NotFoundException);
    await expect(result).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });

  describe('ensureFeaturedProduct', () => {
    function buildSeedingService(stored: Product | null): {
      service: ProductsService;
      insertIfAbsent: jest.Mock<Promise<void>, [Product]>;
    } {
      const insertIfAbsent = jest.fn<Promise<void>, [Product]>().mockResolvedValue();
      const findById = jest.fn<Promise<Product | null>, [string]>().mockResolvedValue(stored);
      const repository = { insertIfAbsent, findById } as unknown as ProductsRepository;
      return { service: new ProductsService(repository), insertIfAbsent };
    }

    it('seeds the featured product row and returns the stored row', async () => {
      const seeded: Product = { ...FEATURED_PRODUCT_SEED };
      const { service, insertIfAbsent } = buildSeedingService(seeded);

      const product = await service.ensureFeaturedProduct();

      expect(insertIfAbsent).toHaveBeenCalledWith(FEATURED_PRODUCT_SEED);
      expect(product).toBe(seeded);
    });

    it('returns an existing row as stored instead of the seed values', async () => {
      const { service } = buildSeedingService(PRODUCT);

      const product = await service.ensureFeaturedProduct();

      expect(product).toBe(PRODUCT);
      expect(product.name).not.toBe(FEATURED_PRODUCT_SEED.name);
    });

    it('rejects with PRODUCT_NOT_FOUND when the row is missing after the seed', async () => {
      const { service } = buildSeedingService(null);

      const result = service.ensureFeaturedProduct();

      await expect(result).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
    });

    it('refreshes the cached product when ensureFeaturedProduct runs', async () => {
      const updated: Product = { ...PRODUCT, name: 'Updated Phone' };
      const insertIfAbsent = jest.fn<Promise<void>, [Product]>().mockResolvedValue();
      const findById = jest
        .fn<Promise<Product | null>, [string]>()
        .mockResolvedValueOnce(PRODUCT)
        .mockResolvedValueOnce(updated);
      const clock = { nowMs: (): number => 1_000 } as unknown as ClockService;
      const service = new ProductsService(
        { insertIfAbsent, findById } as unknown as ProductsRepository,
        clock,
      );

      expect(await service.getFeaturedProduct()).toBe(PRODUCT);
      expect(await service.ensureFeaturedProduct()).toBe(updated);
      expect(await service.getFeaturedProduct()).toBe(updated);
      expect(findById).toHaveBeenCalledTimes(2);
    });
  });

  describe('micro-cache and outage fallback', () => {
    it('serves repeated reads inside 60s from cache and refreshes after TTL expires', async () => {
      const nowRef = { now: 1_000 };
      const { service, findById } = buildService(PRODUCT, nowRef);

      await service.getFeaturedProduct();
      nowRef.now += FEATURED_PRODUCT_CACHE_TTL_MS - 1;
      await service.getFeaturedProduct();
      nowRef.now += 1;
      await service.getFeaturedProduct();

      expect(findById).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent cold-cache reads into one repository query', async () => {
      const { service, findById } = buildService(PRODUCT);

      const results = await Promise.all([
        service.getFeaturedProduct(),
        service.getFeaturedProduct(),
      ]);

      expect(results).toEqual([PRODUCT, PRODUCT]);
      expect(findById).toHaveBeenCalledTimes(1);
    });

    it('forces a fresh read on invalidateCache and drops in-flight cache population', async () => {
      let release: (value: Product | null) => void = () => undefined;
      const { service, findById } = buildService(PRODUCT);
      findById.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

      const inFlight = service.getFeaturedProduct();
      service.invalidateCache();
      release(PRODUCT);
      await inFlight;
      await service.getFeaturedProduct();

      expect(findById).toHaveBeenCalledTimes(2);
    });

    it('never caches NotFoundException when the repository returns null', async () => {
      const { service, findById } = buildService(null);
      findById.mockResolvedValueOnce(null).mockResolvedValueOnce(PRODUCT);

      await expect(service.getFeaturedProduct()).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getFeaturedProduct()).resolves.toBe(PRODUCT);
      expect(findById).toHaveBeenCalledTimes(2);
    });

    it('serves lastKnownProduct with a warning and backs off for 5s when DB is unavailable', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const nowRef = { now: 1_000 };
      const { service, findById } = buildService(PRODUCT, nowRef);
      const dbOutage = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

      expect(await service.getFeaturedProduct()).toBe(PRODUCT);
      nowRef.now += FEATURED_PRODUCT_CACHE_TTL_MS;
      findById.mockRejectedValueOnce(dbOutage);

      await expect(service.getFeaturedProduct()).resolves.toBe(PRODUCT);
      expect(warn).toHaveBeenCalledTimes(1);
      nowRef.now += STALE_PRODUCT_FALLBACK_TTL_MS - 1;
      await expect(service.getFeaturedProduct()).resolves.toBe(PRODUCT);
      expect(findById).toHaveBeenCalledTimes(2);
      nowRef.now += 1;
      await expect(service.getFeaturedProduct()).resolves.toBe(PRODUCT);
      expect(findById).toHaveBeenCalledTimes(3);
    });

    it('rethrows database faults on a cold cache and non-database errors even when warm', async () => {
      const nowRef = { now: 1_000 };
      const cold = buildService(PRODUCT, nowRef);
      cold.findById.mockRejectedValueOnce(Object.assign(new Error('pg down'), { code: '57P01' }));
      await expect(cold.service.getFeaturedProduct()).rejects.toThrow('pg down');

      const warm = buildService(PRODUCT, nowRef);
      await warm.service.getFeaturedProduct();
      nowRef.now += FEATURED_PRODUCT_CACHE_TTL_MS;
      warm.findById.mockRejectedValueOnce(new TypeError('unexpected bug'));
      await expect(warm.service.getFeaturedProduct()).rejects.toThrow('unexpected bug');
    });
  });
});
