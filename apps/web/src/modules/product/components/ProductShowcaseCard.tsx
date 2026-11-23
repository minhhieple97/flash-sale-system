import type { ReactElement } from 'react';
import { Alert } from '@/shared/components/Alert';
import { Card } from '@/shared/components/Card';
import { discountPercent, formatCents } from '@/shared/utils/format-currency.util';
import { useFeaturedProduct } from '../hooks/use-featured-product';
import type { Product } from '../types/product.types';

function ProductImage({ name, imageUrl }: { name: string; imageUrl: string | null }): ReactElement {
  if (imageUrl !== null) {
    return <img src={imageUrl} alt={name} className="h-full w-full object-cover" />;
  }
  return (
    <div
      data-testid="product-image-placeholder"
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-24 w-24 text-white/90"
      >
        <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
        <path d="M9 7V5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function ProductDetails({ product }: { product: Product }): ReactElement {
  const percentOff = discountPercent(product.originalPriceCents, product.salePriceCents);
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8">
      <div className="aspect-square overflow-hidden rounded-2xl">
        <ProductImage name={product.name} imageUrl={product.imageUrl} />
      </div>
      <div className="flex flex-col justify-center gap-4">
        <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
            Limited Edition
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-slate-600">
            {product.sku}
          </span>
        </div>
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-slate-950 sm:text-3xl">
          {product.name}
        </h2>
        <p className="leading-relaxed text-slate-600">{product.description}</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-4xl font-extrabold tracking-tight text-slate-900">
            {formatCents(product.salePriceCents)}
          </span>
          <span className="text-lg text-slate-400">
            <span className="sr-only">Original price</span>
            <del>{formatCents(product.originalPriceCents)}</del>
          </span>
          {percentOff > 0 ? (
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-sm font-bold text-rose-700">
              {percentOff}% OFF
            </span>
          ) : null}
        </div>
        <p className="text-sm font-medium text-indigo-700">Limit 1 Per Customer</p>
      </div>
    </div>
  );
}

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
