import { requestJson } from '@/shared/api/http-client';
import type { HttpResult } from '@/shared/types/api.types';
import { FEATURED_PRODUCT_PATH } from '../constants/product.constants';
import type { Product } from '../types/product.types';

export function fetchFeaturedProduct(): Promise<HttpResult<Product>> {
  return requestJson<Product>({ path: FEATURED_PRODUCT_PATH });
}
