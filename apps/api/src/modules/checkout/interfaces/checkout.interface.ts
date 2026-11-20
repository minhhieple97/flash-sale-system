import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import type { ReservationRef } from '../../orders/interfaces/order.interface';

/** Expected high-frequency refusals. Returned as values, never thrown (no V8 stack capture). */
export type PurchaseRejectionCode =
  | 'ALREADY_PURCHASED'
  | 'SOLD_OUT'
  | 'SALE_UPCOMING'
  | 'SALE_ENDED';

/**
 * Result of CheckoutService.attemptPurchase. Infrastructure faults are deliberately not members:
 * they throw ServiceUnavailableException({ code: TEMPORARY_FAILURE }).
 */
export type PurchaseAttemptResult =
  | { outcome: 'RESERVED'; orderId: string; userId: NormalizedUserId }
  | { outcome: PurchaseRejectionCode };

export type PurchaseOutcome = PurchaseAttemptResult['outcome'];

/**
 * The gatekeeper's verdict. SALE_NOT_CONFIGURED means Redis holds no config for the sale (cold
 * boot before hydration, or mid-reset); CheckoutService turns it into a 503.
 */
export type ReservationVerdict = PurchaseOutcome | 'SALE_NOT_CONFIGURED';

export interface ExecuteReservationParams extends ReservationRef {
  nowMs: number;
}
