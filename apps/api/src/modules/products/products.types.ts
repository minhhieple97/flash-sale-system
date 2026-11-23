export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  originalPriceCents: number;
  salePriceCents: number;
  imageUrl: string | null;
}

export interface FeaturedProductCacheEntry {
  product: Promise<Product>;
  expiresAtMs: number;
}

export class ProductResponseDto {
  id!: string;
  sku!: string;
  name!: string;
  description!: string;
  originalPriceCents!: number;
  salePriceCents!: number;
  imageUrl!: string | null;

  static from(product: Product): ProductResponseDto {
    return Object.assign(new ProductResponseDto(), {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      originalPriceCents: product.originalPriceCents,
      salePriceCents: product.salePriceCents,
      imageUrl: product.imageUrl,
    });
  }
}

export const FEATURED_PRODUCT_ID = '00000000-0000-4000-8000-000000000002';
/** Row FlashSaleHydrationService seeds on boot when `products` lacks FEATURED_PRODUCT_ID. */
export const FEATURED_PRODUCT_SEED: Readonly<Product> = {
  id: FEATURED_PRODUCT_ID,
  sku: 'TITAN-X1-LE',
  name: 'Titan X1 Carbon Wireless Mechanical Keyboard',
  description: 'Limited-edition carbon-fiber wireless mechanical keyboard. Limit 1 per customer.',
  originalPriceCents: 24_900,
  salePriceCents: 12_900,
  imageUrl: null,
};
export const PRODUCT_ERROR_CODES = { PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND' } as const;
export const PRODUCT_NOT_FOUND_MESSAGE = 'Featured product not found';
export const FEATURED_PRODUCT_CACHE_TTL_MS = 60_000;
export const STALE_PRODUCT_FALLBACK_TTL_MS = 5_000;
export const FEATURED_PRODUCT_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';
export const PRODUCTS_ROUTE = 'products';
export const FEATURED_PRODUCT_ROUTE = 'featured';
