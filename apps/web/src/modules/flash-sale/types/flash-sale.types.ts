import type { ApiError } from '@/shared/types/api.types';
import type { Tone } from '@/shared/types/tone.types';

export type SaleState = 'UPCOMING' | 'ACTIVE' | 'SOLD_OUT' | 'ENDED';

export interface FlashSaleStatus {
  saleId: string;
  productId: string;
  productName: string;
  salePriceCents: number;
  originalPriceCents: number;
  saleState: SaleState;
  totalStock: number;
  remainingStock: number;
  startsAt: string;
  endsAt: string;
  serverTime: string;
}

export interface FlashSaleFeed {
  sale: FlashSaleStatus | null;
  error: ApiError | null;
}

export interface FlashSaleStatusHandle extends FlashSaleFeed {
  applySnapshot: (sale: FlashSaleStatus) => void;
}

export interface SaleStatePresentation {
  label: string;
  tone: Tone;
  countdown: { label: string; target: 'startsAt' | 'endsAt' } | null;
}

export interface ServerCountdownParams {
  targetAt: string;
  serverTime: string;
}
