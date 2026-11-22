import { useEffect, useState } from 'react';
import type { AsyncState } from '@/shared/types/async-state.types';
import { fetchFeaturedProduct } from '../api/product.api';
import type { Product } from '../types/product.types';

export function useFeaturedProduct(): AsyncState<Product> {
  const [state, setState] = useState<AsyncState<Product>>({ status: 'loading' });

  useEffect(() => {
    let isActive = true;
    fetchFeaturedProduct().then((result) => {
      if (!isActive) return;
      setState(
        result.ok
          ? { status: 'success', data: result.data }
          : { status: 'error', error: result.error },
      );
    });
    return () => {
      isActive = false;
    };
  }, []);

  return state;
}
