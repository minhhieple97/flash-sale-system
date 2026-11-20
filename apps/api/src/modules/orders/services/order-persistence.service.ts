import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ORDER_PERSISTENCE_QUEUE } from '../../../infrastructure/queue/queue.constants';
import {
  ORDER_PERSISTENCE_JOB_NAME,
  ORDER_PERSISTENCE_JOB_OPTIONS,
  orderPersistenceJobId,
} from '../constants/orders.constants';
import type {
  PersistOrderResult,
  ReleaseOutcome,
  ReservationRef,
  ScheduleReservationOutcome,
} from '../interfaces/order.interface';
import { OrderCacheRepository } from '../repositories/order-cache.repository';
import { OrdersRepository } from '../repositories/orders.repository';

/**
 * Reservation -> durable order pipeline, and its self-healing. Owns the invariant: every RESERVED
 * entry either has a persistence job or is released. Exported by OrdersModule.
 */
@Injectable()
export class OrderPersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceService.name);

  constructor(
    @InjectQueue(ORDER_PERSISTENCE_QUEUE) private readonly queue: Queue<ReservationRef>,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderCache: OrderCacheRepository,
  ) {}

  /**
   * A failed add can still have stored the job (the reply was lost). Releasing then would hand
   * the unit out twice, so the reservation is released only once the job is known to be absent.
   * When even that check fails, the error propagates (503) and the reservation stays put.
   */
  async scheduleReservation(ref: ReservationRef): Promise<ScheduleReservationOutcome> {
    const jobId = orderPersistenceJobId(ref);
    try {
      await this.queue.add(ORDER_PERSISTENCE_JOB_NAME, ref, {
        ...ORDER_PERSISTENCE_JOB_OPTIONS,
        jobId,
      });
      return 'QUEUED';
    } catch (error) {
      this.logger.warn(`Enqueue failed for order ${ref.orderId}: ${String(error)}`);
      if (await this.queue.getJob(jobId)) return 'QUEUED';
      await this.orderCache.releaseReservation(ref);
      return 'RELEASED';
    }
  }

  /** Never marks CONFIRMED before the commit. Any fault rejects, so BullMQ retries. */
  async persistReservedOrder(ref: ReservationRef): Promise<PersistOrderResult> {
    const result = await this.ordersRepository.persistConfirmedOrder(ref);
    await this.orderCache.markConfirmed({ ...ref, orderId: result.orderId });
    return result;
  }

  /** Idempotent: a repeat call, or an entry already CONFIRMED, returns NOT_RESERVED. */
  async compensateFailedOrder(ref: ReservationRef): Promise<ReleaseOutcome> {
    return this.orderCache.releaseReservation(ref);
  }

  async discardSaleOrders(saleId: string): Promise<void> {
    await this.queue.obliterate({ force: true });
    await this.ordersRepository.deleteBySale(saleId);
  }

  /** Closed in the destroy phase, before RedisModule quits at application shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
