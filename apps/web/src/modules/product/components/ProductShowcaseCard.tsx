import type { ReactElement } from 'react';
import { Alert } from '@/shared/components/Alert';
import { Card } from '@/shared/components/Card';
import { useFeaturedProduct } from '../hooks/use-featured-product';
import { ProductDetails } from './ProductDetails';

function LoadingPlaceholder(): ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading product"
      className="grid animate-pulse gap-6 sm:grid-cols-2"
    >
      <div className="aspect-square rounded-xl bg-slate-200" />
      <div className="space-y-4">
        <div className="h-5 w-1/3 rounded bg-slate-200" />
        <div className="h-8 w-3/4 rounded bg-slate-200" />
        <div className="h-16 rounded bg-slate-200" />
      </div>
    </div>
  );
}

export function ProductShowcaseCard(): ReactElement {
  const state = useFeaturedProduct();

  if (state.status === 'success') {
    return (
      <Card>
        <ProductDetails product={state.data} />
      </Card>
    );
  }
  if (state.status === 'error') {
    return (
      <Card>
        <Alert tone="danger" title="Could not load the product">
          {state.error.message}
        </Alert>
      </Card>
    );
  }
  return (
    <Card>
      <LoadingPlaceholder />
    </Card>
  );
}
