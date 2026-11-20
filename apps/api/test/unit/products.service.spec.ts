import { NotFoundException } from '@nestjs/common';
import {
  FEATURED_PRODUCT_ID,
  FEATURED_PRODUCT_SEED,
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

function buildService(found: Product | null): {
  service: ProductsService;
  findById: jest.Mock<Promise<Product | null>, [string]>;
} {
  const findById = jest.fn<Promise<Product | null>, [string]>().mockResolvedValue(found);
  const repository = { findById } as unknown as ProductsRepository;
  return { service: new ProductsService(repository), findById };
}

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
  });
});
