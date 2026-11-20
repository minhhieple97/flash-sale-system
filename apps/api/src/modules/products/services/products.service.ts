import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FEATURED_PRODUCT_ID,
  FEATURED_PRODUCT_SEED,
  PRODUCT_ERROR_CODES,
  PRODUCT_NOT_FOUND_MESSAGE,
} from '../constants/products.constants';
import type { Product } from '../interfaces/product.interface';
import { ProductsRepository } from '../repositories/products.repository';

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async getFeaturedProduct(): Promise<Product> {
    const product = await this.productsRepository.findById(FEATURED_PRODUCT_ID);
    if (!product) {
      throw new NotFoundException({
        code: PRODUCT_ERROR_CODES.PRODUCT_NOT_FOUND,
        message: PRODUCT_NOT_FOUND_MESSAGE,
      });
    }
    return product;
  }

  /** Boot-time seed. An existing product comes back unchanged. */
  async ensureFeaturedProduct(): Promise<Product> {
    await this.productsRepository.insertIfAbsent(FEATURED_PRODUCT_SEED);
    return this.getFeaturedProduct();
  }
}
