import type { ReactElement } from 'react';
import { discountPercent, formatCents } from '@/shared/utils/format-currency.util';

interface ProductPriceProps {
  originalPriceCents: number;
  salePriceCents: number;
}

export function ProductPrice({
  originalPriceCents,
  salePriceCents,
}: ProductPriceProps): ReactElement {
  const percentOff = discountPercent(originalPriceCents, salePriceCents);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-4xl font-extrabold tracking-tight text-slate-900">
        {formatCents(salePriceCents)}
      </span>
      <span className="text-lg text-slate-400">
        <span className="sr-only">Original price</span>
        <del>{formatCents(originalPriceCents)}</del>
      </span>
      {percentOff > 0 ? (
        <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-sm font-bold text-rose-700">
          {percentOff}% OFF
        </span>
      ) : null}
    </div>
  );
}
