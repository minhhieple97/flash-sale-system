import type { OrphanSweepSummary } from '../../orders/interfaces/order.interface';
import type { LedgerHydrationResult } from '../../sale-ledger';

/** Body of POST /api/v1/admin/flash-sales/reset. Every field is optional. */
export interface ResetFlashSaleInput {
  totalStock?: number;
  startsOffsetSeconds?: number;
  durationSeconds?: number;
  startsAt?: string;
  endsAt?: string;
}

export interface ResetFlashSalePlan {
  totalStock: number;
  startsAtMs: number;
  endsAtMs: number;
}

export type MaintenanceTickResult =
  | { status: 'SKIPPED_BUSY' }
  | {
      status: 'RAN';
      hydration: LedgerHydrationResult;
      sweep: OrphanSweepSummary;
    };

export type MaintenanceIntervalMs = number | null;
