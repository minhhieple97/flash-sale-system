import { useEffect, useState } from 'react';
import { requestJson } from '@/shared/api/http-client';
import type { AsyncState } from '@/shared/types/common.types';
import type { Product } from '../types/product.types';

const FEATURED_PRODUCT_PATH = '/products/featured';

export function useFeaturedProduct(): AsyncState<Product> {
  const [state, setState] = useState<AsyncState<Product>>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void requestJson<Product>({ path: FEATURED_PRODUCT_PATH }).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { status: 'success', data: result.data }
          : { status: 'error', error: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
