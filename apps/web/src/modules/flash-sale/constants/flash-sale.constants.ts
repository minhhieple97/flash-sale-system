import type { SaleState, SaleStatePresentation } from '../types/flash-sale.types';

export const CURRENT_FLASH_SALE_PATH = '/flash-sales/current';
export const STATUS_POLL_INTERVAL_MS = 2000;
export const COUNTDOWN_TICK_MS = 250;
export const LOW_STOCK_PERCENT = 20;

export const SALE_STATE_PRESENTATION: Readonly<Record<SaleState, SaleStatePresentation>> = {
  UPCOMING: {
    label: 'Upcoming',
    tone: 'info',
    countdown: { label: 'Starts in', target: 'startsAt' },
  },
  ACTIVE: {
    label: 'Live now',
    tone: 'success',
    countdown: { label: 'Ends in', target: 'endsAt' },
  },
  SOLD_OUT: { label: 'Sold out', tone: 'danger', countdown: null },
  ENDED: { label: 'Ended', tone: 'neutral', countdown: null },
};
