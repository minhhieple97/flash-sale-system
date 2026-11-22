import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import type {
  ConfirmedReservation,
  ConfirmOutcome,
  ReleaseOutcome,
  ReservationRef,
  ReservationSlot,
} from '../../sale-ledger';

export interface ConfirmedBatchCursor {
  createdAt: string;
  id: string;
}

export interface ListConfirmedBatchParams {
  saleId: string;
  limit: number;
  cursor?: ConfirmedBatchCursor;
}

export interface ConfirmedBatchPage {
  entries: readonly ConfirmedReservation[];
  nextCursor: ConfirmedBatchCursor | null;
}

export type OrderState = ReservationSlot['status'];

export type UserOrderStatus = ReservationSlot & { userId: NormalizedUserId };

/** CONFIRMED: PostgreSQL already held the order, so the entry was confirmed instead of released. */
export type CompensationOutcome = ConfirmOutcome | ReleaseOutcome;

/**
 * QUEUED: the job is in ORDER_PERSISTENCE_QUEUE.
 * RELEASED: enqueue failed and the reservation was rolled back (stock restored).
 */
export type ScheduleReservationOutcome = 'QUEUED' | 'RELEASED';

/**
 * `orderId` is the stored row's id, which is the job's orderId unless a row already existed.
 * STALE: the reservation was released or wiped before the job ran; nothing was written.
 */
export interface PersistOrderResult {
  outcome: 'INSERTED' | 'ALREADY_PERSISTED' | 'STALE';
  orderId: string;
}

export type PersistRejectionReason = 'STOCK_INVARIANT_VIOLATION' | 'SALE_NOT_FOUND';

export type SweepTrigger = 'BOOT' | 'INTERVAL';

export type OrphanStrikes = ReadonlyMap<string, number>;

export interface SweepDecision {
  toCompensate: readonly ReservationRef[];
  nextStrikes: OrphanStrikes;
}

export interface OrphanSweepSummary {
  pending: number;
  candidates: number;
  compensated: Record<CompensationOutcome, number>;
}

/** What a job on ORDER_PERSISTENCE_QUEUE returns, whichever job name it carries. */
export type OrderJobResult = PersistOrderResult | CompensationOutcome;
