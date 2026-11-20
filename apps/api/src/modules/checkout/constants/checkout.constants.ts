import { HttpStatus } from '@nestjs/common';
import type { PurchaseAttemptRequestDto } from '../dto/purchase-attempt.request.dto';
import type { PurchaseOutcome } from '../interfaces/checkout.interface';

export const CHECKOUT_ROUTE = 'checkout';
export const PURCHASE_ROUTE = 'purchase';
export const PURCHASE_USER_ID_FIELD = 'userId' satisfies keyof PurchaseAttemptRequestDto;

/** Exhaustive by type: adding a PurchaseOutcome without a status fails the build. */
export const PURCHASE_HTTP_STATUS: Readonly<Record<PurchaseOutcome, HttpStatus>> = {
  RESERVED: HttpStatus.ACCEPTED,
  ALREADY_PURCHASED: HttpStatus.CONFLICT,
  SOLD_OUT: HttpStatus.GONE,
  SALE_UPCOMING: HttpStatus.UNPROCESSABLE_ENTITY,
  SALE_ENDED: HttpStatus.UNPROCESSABLE_ENTITY,
};

export const PURCHASE_MESSAGES: Readonly<Record<PurchaseOutcome, string>> = {
  RESERVED: 'Your unit is reserved; the order is being confirmed',
  ALREADY_PURCHASED: 'This user already holds a unit from this sale',
  SOLD_OUT: 'The flash sale is sold out',
  SALE_UPCOMING: 'The flash sale has not started yet',
  SALE_ENDED: 'The flash sale has ended',
};
