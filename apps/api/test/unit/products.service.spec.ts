import { NotFoundException } from '@nestjs/common';
import { FEATURED_PRODUCT_ID } from '../../src/modules/products/constants/products.constants';
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
});
