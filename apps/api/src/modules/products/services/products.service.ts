import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClockService } from '../../../common/providers/clock.service';
import { isDatabaseUnavailable } from '../../../infrastructure/database/database-fault.util';
import {
  FEATURED_PRODUCT_CACHE_TTL_MS,
  FEATURED_PRODUCT_ID,
  FEATURED_PRODUCT_SEED,
  PRODUCT_ERROR_CODES,
  PRODUCT_NOT_FOUND_MESSAGE,
  STALE_PRODUCT_FALLBACK_TTL_MS,
} from '../constants/products.constants';
import type { FeaturedProductCacheEntry, Product } from '../interfaces/product.interface';
import { ProductsRepository } from '../repositories/products.repository';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private entry: FeaturedProductCacheEntry | null = null;
  private lastKnownProduct: Product | null = null;

  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly clock: ClockService = new ClockService(),
  ) {}

  async getFeaturedProduct(): Promise<Product> {
    const nowMs = this.clock.nowMs();
    if (this.entry && nowMs < this.entry.expiresAtMs) return this.entry.product;
    const entry: FeaturedProductCacheEntry = {
      product: this.loadFeatured(() => this.entry === entry),
      expiresAtMs: nowMs + FEATURED_PRODUCT_CACHE_TTL_MS,
    };
    this.entry = entry;
    return entry.product;
  }

  /** Boot-time seed. An existing product comes back unchanged and refreshes the cache. */
  async ensureFeaturedProduct(): Promise<Product> {
    await this.productsRepository.insertIfAbsent(FEATURED_PRODUCT_SEED);
    this.invalidateCache();
    return this.getFeaturedProduct();
  }

  invalidateCache(): void {
    this.entry = null;
  }

  private async loadFeatured(isCurrent: () => boolean): Promise<Product> {
    try {
      const product = await this.fetchFeaturedFromDb();
      if (isCurrent()) this.lastKnownProduct = product;
      return product;
    } catch (error: unknown) {
      if (isDatabaseUnavailable(error) && this.lastKnownProduct !== null) {
        if (isCurrent()) {
          this.entry = {
            product: Promise.resolve(this.lastKnownProduct),
            expiresAtMs: this.clock.nowMs() + STALE_PRODUCT_FALLBACK_TTL_MS,
          };
        }
        this.logger.warn(
          `Database unavailable while loading featured product; serving stale cached copy: ${String(error)}`,
        );
        return this.lastKnownProduct;
      }
      if (isCurrent()) this.entry = null;
      throw error;
    }
  }

  private async fetchFeaturedFromDb(): Promise<Product> {
    const product = await this.productsRepository.findById(FEATURED_PRODUCT_ID);
    if (!product) {
      this.lastKnownProduct = null;
      throw new NotFoundException({
        code: PRODUCT_ERROR_CODES.PRODUCT_NOT_FOUND,
        message: PRODUCT_NOT_FOUND_MESSAGE,
      });
    }
    return product;
  }
}
