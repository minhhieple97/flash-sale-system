import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES } from '../../../common/constants/common.constants';
import { temporaryFailure } from '../../../common/errors/temporary-failure.error';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import { ClockService } from '../../../common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import { MetricsService } from '../../metrics/services/metrics.service';
import { OrderPersistenceService } from '../../orders/services/order-persistence.service';
import { type ReservationRef, SaleLedgerRepository } from '../../sale-ledger';
import type { PurchaseAttemptResult } from '../interfaces/checkout.interface';

const UNRECOVERABLE_BUG_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError] as const;
const UNEXPECTED_REPLY_PATTERN = /^Unexpected (?:\S+ reply:|reply from) /;

function isUnexpectedBugError(error: unknown): boolean {
  if (UNRECOVERABLE_BUG_ERRORS.some((ErrorType) => error instanceof ErrorType)) return true;
  return error instanceof Error && UNEXPECTED_REPLY_PATTERN.test(error.message);
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly ledger: SaleLedgerRepository,
    private readonly orderPersistence: OrderPersistenceService,
    private readonly clock: ClockService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Rejections are returned as values: they are the hot path and must not capture a stack.
   * Infrastructure faults convert to ServiceUnavailableException({ code: TEMPORARY_FAILURE }),
   * while programming/corrupt-reply errors rethrow to GlobalExceptionFilter -> 500 INTERNAL_ERROR.
   */
  async attemptPurchase(userId: NormalizedUserId): Promise<PurchaseAttemptResult> {
    const ref: ReservationRef = { saleId: ACTIVE_FLASH_SALE_ID, userId, orderId: randomUUID() };
    try {
      const result = await this.reserveAndSchedule(ref);
      this.metrics?.recordPurchaseAttempt(result.outcome);
      return result;
    } catch (error) {
      if (isUnexpectedBugError(error)) throw error;
      this.metrics?.recordPurchaseAttempt(ERROR_CODES.TEMPORARY_FAILURE);
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`Purchase attempt failed for order ${ref.orderId}: ${String(error)}`);
      throw temporaryFailure();
    }
  }

  private async reserveAndSchedule(ref: ReservationRef): Promise<PurchaseAttemptResult> {
    const verdict = await this.ledger.reserve({ ...ref, nowMs: this.clock.nowMs() });
    if (verdict === 'SALE_NOT_CONFIGURED') {
      this.logger.warn(`Sale ${ref.saleId} is not configured in Redis for order ${ref.orderId}`);
      throw temporaryFailure();
    }
    if (verdict !== 'RESERVED') return { outcome: verdict };
    if ((await this.orderPersistence.scheduleReservation(ref)) === 'RELEASED') {
      throw temporaryFailure();
    }
    return { outcome: 'RESERVED', orderId: ref.orderId, userId: ref.userId };
  }
}
