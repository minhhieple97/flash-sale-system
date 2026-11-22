import type { OrphanSweepSummary, SweepTrigger } from '../../orders/interfaces/order.interface';
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

export type PendingResetOutcome = 'NONE' | 'COMPLETED';

export type LockAttempt<T> = { ran: true; value: T } | { ran: false };

export type MaintenanceTickResult =
  | { status: 'SKIPPED_BUSY' }
  | {
      status: 'RAN';
      reset: PendingResetOutcome;
      hydration: LedgerHydrationResult;
      sweep: OrphanSweepSummary;
    };

export type MaintenanceIntervalMs = number | null;
export type BootstrapSweepTrigger = SweepTrigger | null;
