import type { Product } from '../interfaces/product.interface';

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
export const FEATURED_PRODUCT_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';
export const PRODUCTS_ROUTE = 'products';
export const FEATURED_PRODUCT_ROUTE = 'featured';
