import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';

export interface FlashSaleSnapshot {
  saleId: string;
  totalStock: number;
  remainingStock: number;
  startsAtMs: number;
  endsAtMs: number;
}

export type SnapshotRead =
  | { status: 'FOUND'; snapshot: FlashSaleSnapshot }
  | { status: 'NOT_CONFIGURED' }
  | { status: 'STOCK_MISSING' };

export type ReservationSlot =
  | { status: 'NONE' }
  | { status: 'RESERVED'; orderId: string }
  | { status: 'CONFIRMED'; orderId: string };

export interface SlotReadWithLedgerState {
  slot: ReservationSlot;
  isLedgerIntact: boolean;
}

export interface ReservationRef {
  saleId: string;
  userId: NormalizedUserId;
  orderId: string;
}

export interface ConfirmedReservation {
  userId: NormalizedUserId;
  orderId: string;
}

export interface SaleLedgerState {
  snapshot: FlashSaleSnapshot;
  confirmed: readonly ConfirmedReservation[];
}

export interface AttemptPurchaseParams extends ReservationRef {
  nowMs: number;
}

export type ReservationVerdict =
  | 'RESERVED'
  | 'ALREADY_PURCHASED'
  | 'SOLD_OUT'
  | 'SALE_UPCOMING'
  | 'SALE_ENDED'
  | 'SALE_NOT_CONFIGURED';

export type ReleaseOutcome = 'RELEASED' | 'NOT_RESERVED';

export type ConfirmOutcome = 'CONFIRMED' | 'NOT_RESERVED';

export type AdoptOutcome = 'ADOPTED' | 'NOT_ADOPTED';

export type LedgerHydrationResult = 'HYDRATED' | 'ALREADY_PRESENT';

export interface MaintenanceLease {
  saleId: string;
  ownerToken: string;
  ttlMs: number;
}
