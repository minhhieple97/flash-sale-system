import type { ReactElement } from 'react';
import { LOW_STOCK_PERCENT } from '../constants/flash-sale.constants';

interface StockProgressBarProps {
  remaining: number;
  total: number;
}

function stockPercent(remaining: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((remaining / total) * 100)));
}

export function StockProgressBar({ remaining, total }: StockProgressBarProps): ReactElement {
  const percent = stockPercent(remaining, total);
  const fillColor = percent <= LOW_STOCK_PERCENT ? 'bg-rose-500' : 'bg-emerald-500';
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Stock remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${fillColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {remaining} of {total} left
      </p>
    </div>
  );
}
