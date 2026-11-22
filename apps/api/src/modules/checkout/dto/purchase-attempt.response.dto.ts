import { PURCHASE_MESSAGES } from '../constants/checkout.constants';
import type {
  PurchaseAttemptResult,
  PurchaseRejectionCode,
} from '../interfaces/checkout.interface';

/**
 * 202 -> `{ code: 'RESERVED', orderId, userId, message }`
 * 409 / 410 / 422 -> `{ code, message }` (same shape as ApiError)
 */
export type PurchaseAttemptResponseDto =
  | { code: 'RESERVED'; orderId: string; userId: string; message: string }
  | { code: PurchaseRejectionCode; message: string };

export function toPurchaseAttemptResponse(
  result: PurchaseAttemptResult,
): PurchaseAttemptResponseDto {
  const message = PURCHASE_MESSAGES[result.outcome];
  if (result.outcome === 'RESERVED') {
    return { code: 'RESERVED', orderId: result.orderId, userId: result.userId, message };
  }
  return { code: result.outcome, message };
}
