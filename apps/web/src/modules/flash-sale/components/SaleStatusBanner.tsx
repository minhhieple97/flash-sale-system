import type { ReactElement } from 'react';
import { Alert } from '@/shared/components/Alert';
import { Card } from '@/shared/components/Card';
import { StatusPill } from '@/shared/components/StatusPill';
import { SALE_STATE_PRESENTATION } from '../constants/flash-sale.constants';
import { useEffectiveSaleState } from '../hooks/use-effective-sale-state';
import type { FlashSaleFeed, FlashSaleStatus } from '../types/flash-sale.types';
import { CountdownTimer } from './CountdownTimer';
import { StockProgressBar } from './StockProgressBar';

interface SaleStatusBannerProps {
  feed: FlashSaleFeed;
}

function LoadingPlaceholder(): ReactElement {
  return (
    <div role="status" aria-label="Loading sale status" className="animate-pulse space-y-3">
      <div className="h-6 w-24 rounded-full bg-slate-200" />
      <div className="h-3 w-full rounded-full bg-slate-200" />
    </div>
  );
}

function SaleDetails({ sale }: { sale: FlashSaleStatus }): ReactElement {
  const effectiveState = useEffectiveSaleState(sale) ?? sale.saleState;
  const presentation = SALE_STATE_PRESENTATION[effectiveState];
  const countdown = presentation.countdown;
  return (
    <div className="space-y-4">
      <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
      {countdown ? (
        <CountdownTimer
          label={countdown.label}
          targetAt={sale[countdown.target]}
          serverTime={sale.serverTime}
        />
      ) : null}
      <StockProgressBar remaining={sale.remainingStock} total={sale.totalStock} />
    </div>
  );
}

export function SaleStatusBanner({ feed }: SaleStatusBannerProps): ReactElement {
  const { sale, error } = feed;
  if (sale === null && error !== null) {
    return (
      <Card title="Sale status">
        <Alert tone="danger" title="Could not load the sale status">
          {error.message}
        </Alert>
      </Card>
    );
  }
  return (
    <Card title="Sale status">
      {sale === null ? <LoadingPlaceholder /> : <SaleDetails sale={sale} />}
      {sale !== null && error !== null ? (
        <p className="mt-3 text-xs text-amber-700">Reconnecting...</p>
      ) : null}
    </Card>
  );
}
