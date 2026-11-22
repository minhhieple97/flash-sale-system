import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import type { ReservationVerdict } from '../../sale-ledger';

export type PurchaseOutcome = Exclude<ReservationVerdict, 'SALE_NOT_CONFIGURED'>;

/** Expected high-frequency refusals. Returned as values, never thrown (no V8 stack capture). */
export type PurchaseRejectionCode = Exclude<PurchaseOutcome, 'RESERVED'>;

/**
 * Result of CheckoutService.attemptPurchase. Infrastructure faults are deliberately not members:
 * they throw ServiceUnavailableException({ code: TEMPORARY_FAILURE }).
 */
export type PurchaseAttemptResult =
  | { outcome: 'RESERVED'; orderId: string; userId: NormalizedUserId }
  | { outcome: PurchaseRejectionCode };
