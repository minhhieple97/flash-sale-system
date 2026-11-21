import type { ReactElement } from 'react';
import { LIMITED_EDITION_LABEL, PURCHASE_LIMIT_LABEL } from '../constants/product.constants';
import type { Product } from '../types/product.types';
import { ProductImage } from './ProductImage';
import { ProductPrice } from './ProductPrice';

interface ProductDetailsProps {
  product: Product;
}

export function ProductDetails({ product }: ProductDetailsProps): ReactElement {
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="aspect-square overflow-hidden rounded-xl">
        <ProductImage name={product.name} imageUrl={product.imageUrl} />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
            {LIMITED_EDITION_LABEL}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-slate-600">
            {product.sku}
          </span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900">{product.name}</h2>
        <p className="text-slate-600">{product.description}</p>
        <ProductPrice
          originalPriceCents={product.originalPriceCents}
          salePriceCents={product.salePriceCents}
        />
        <p className="text-sm font-medium text-indigo-700">{PURCHASE_LIMIT_LABEL}</p>
      </div>
    </div>
  );
}
