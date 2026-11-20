import { randomUUID } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES, TEMPORARY_FAILURE_MESSAGE } from '../../../common/constants/common.constants';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import { ClockService } from '../../../common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type { ReservationRef } from '../../orders/interfaces/order.interface';
import { OrderPersistenceService } from '../../orders/services/order-persistence.service';
import type { PurchaseAttemptResult } from '../interfaces/checkout.interface';
import { CheckoutGatekeeperRepository } from '../repositories/checkout-gatekeeper.repository';

const temporaryFailure = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: ERROR_CODES.TEMPORARY_FAILURE,
    message: TEMPORARY_FAILURE_MESSAGE,
  });

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly gatekeeper: CheckoutGatekeeperRepository,
    private readonly orderPersistence: OrderPersistenceService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Rejections are returned as values: they are the hot path and must not capture a stack.
   * Only infrastructure faults throw, as ServiceUnavailableException({ code: TEMPORARY_FAILURE }).
   */
  async attemptPurchase(userId: NormalizedUserId): Promise<PurchaseAttemptResult> {
    const ref: ReservationRef = { saleId: ACTIVE_FLASH_SALE_ID, userId, orderId: randomUUID() };
    try {
      return await this.reserveAndSchedule(ref);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`Purchase attempt failed for order ${ref.orderId}: ${String(error)}`);
      throw temporaryFailure();
    }
  }

  private async reserveAndSchedule(ref: ReservationRef): Promise<PurchaseAttemptResult> {
    const verdict = await this.gatekeeper.executeAtomicReservation({
      ...ref,
      nowMs: this.clock.nowMs(),
    });
    if (verdict === 'SALE_NOT_CONFIGURED') throw temporaryFailure();
    if (verdict !== 'RESERVED') return { outcome: verdict };
    if ((await this.orderPersistence.scheduleReservation(ref)) === 'RELEASED') {
      throw temporaryFailure();
    }
    return { outcome: 'RESERVED', orderId: ref.orderId, userId: ref.userId };
  }
}
