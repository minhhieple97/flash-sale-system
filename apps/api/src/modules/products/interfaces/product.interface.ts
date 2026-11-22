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
