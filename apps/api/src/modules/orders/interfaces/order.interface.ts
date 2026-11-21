import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import type { FlashSaleSnapshot } from '../../flash-sales/interfaces/flash-sale.interface';

/**
 * Domain view of one `flash_sale:{saleId}:users` entry. The Redis string format
 * (`RESERVED:<orderId>` / `CONFIRMED:<orderId>`) never leaves OrderCacheRepository.
 */
export type ReservationSlot =
  | { status: 'NONE' }
  | { status: 'RESERVED'; orderId: string }
  | { status: 'CONFIRMED'; orderId: string };

export type OrderState = ReservationSlot['status'];

export type UserOrderStatus = ReservationSlot & { userId: NormalizedUserId };

/** Identity of one reservation. Also the BullMQ job payload of ORDER_PERSISTENCE_QUEUE. */
export interface ReservationRef {
  saleId: string;
  userId: NormalizedUserId;
  orderId: string;
}

export interface ConfirmedReservation {
  userId: NormalizedUserId;
  orderId: string;
}

/**
 * Complete Redis state of one sale: config hash + stock (`snapshot.remainingStock`) + users hash
 * holding exactly `confirmed` as CONFIRMED entries. Written in one atomic step.
 */
export interface SaleLedgerState {
  snapshot: FlashSaleSnapshot;
  confirmed: readonly ConfirmedReservation[];
}

/** ALREADY_PRESENT: the config hash existed, so live state was left untouched. */
export type LedgerHydrationResult = 'HYDRATED' | 'ALREADY_PRESENT';

/** NOT_RESERVED: entry absent, CONFIRMED, or held by another orderId. Nothing changed. */
export type ReleaseOutcome = 'RELEASED' | 'NOT_RESERVED';

/** CONFIRMED: PostgreSQL already held the order, so the entry was confirmed instead of released. */
export type CompensationOutcome = 'CONFIRMED' | ReleaseOutcome;

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

/**
 * Boot reconciliation of one sale. `pending`: RESERVED entries left to a job that can still run.
 * `orphans`: what compensation did with each RESERVED entry that had none.
 */
export interface ReconciliationSummary {
  pending: number;
  orphans: Record<CompensationOutcome, number>;
}

/** What a job on ORDER_PERSISTENCE_QUEUE returns, whichever job name it carries. */
export type OrderJobResult = PersistOrderResult | CompensationOutcome;
