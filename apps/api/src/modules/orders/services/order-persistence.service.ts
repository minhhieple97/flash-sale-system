import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ERROR_CODES, TEMPORARY_FAILURE_MESSAGE } from '../../../common/constants/common.constants';
import { ORDER_PERSISTENCE_QUEUE } from '../../../infrastructure/queue/queue.constants';
import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_COMPENSATION_JOB_OPTIONS,
  ORDER_PERSISTENCE_JOB_NAME,
  ORDER_PERSISTENCE_JOB_OPTIONS,
  orderCompensationJobId,
  orderPersistenceJobId,
  RESET_ACTIVE_JOBS_POLL_MS,
  RESET_ACTIVE_JOBS_TIMEOUT_MS,
} from '../constants/orders.constants';
import type {
  CompensationOutcome,
  PersistOrderResult,
  ReservationRef,
  ScheduleReservationOutcome,
} from '../interfaces/order.interface';
import { OrderCacheRepository } from '../repositories/order-cache.repository';
import { OrdersRepository } from '../repositories/orders.repository';

/**
 * Reservation -> durable order pipeline, and its self-healing. Owns the invariant: every RESERVED
 * entry either has a persistence job or is released, and a job whose entry is gone writes nothing.
 * Exported by OrdersModule.
 */
@Injectable()
export class OrderPersistenceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceService.name);

  constructor(
    @InjectQueue(ORDER_PERSISTENCE_QUEUE) private readonly queue: Queue<ReservationRef>,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderCache: OrderCacheRepository,
  ) {}

  /** The pause is global and stored in Redis: a reset that crashed before its resume would keep it. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.resume();
  }

  /**
   * A failed add can still have stored the job (the reply was lost). The reservation is kept only
   * when the job is known to exist; otherwise it is released, and a job that was stored after all
   * finds no entry and ends STALE. A release error propagates (503).
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
      if (await this.isJobStored(jobId)) return 'QUEUED';
      await this.orderCache.releaseReservation(ref);
      return 'RELEASED';
    }
  }

  /**
   * Writes only while the entry still holds this job's orderId: a reservation released or wiped by a
   * reset makes the job STALE. Never marks CONFIRMED before the commit. Any fault rejects (retry).
   */
  async persistReservedOrder(ref: ReservationRef): Promise<PersistOrderResult> {
    if (!(await this.isReservationLive(ref))) return { outcome: 'STALE', orderId: ref.orderId };
    const result = await this.ordersRepository.persistConfirmedOrder(ref);
    await this.orderCache.markConfirmed({ ...ref, orderId: result.orderId });
    return result;
  }

  /**
   * PostgreSQL decides: an order committed by an attempt whose CONFIRMED write was lost is confirmed,
   * anything else is released. Idempotent; infrastructure faults reject so BullMQ retries.
   */
  async compensateFailedOrder(ref: ReservationRef): Promise<CompensationOutcome> {
    const storedOrderId = await this.ordersRepository.findConfirmedOrderId(ref.saleId, ref.userId);
    if (storedOrderId === null) return this.orderCache.releaseReservation(ref);
    await this.orderCache.markConfirmed({ ...ref, orderId: storedOrderId });
    return 'CONFIRMED';
  }

  async scheduleCompensation(ref: ReservationRef): Promise<void> {
    await this.queue.add(ORDER_COMPENSATION_JOB_NAME, ref, {
      ...ORDER_COMPENSATION_JOB_OPTIONS,
      jobId: orderCompensationJobId(ref),
    });
  }

  /**
   * Leaves the queue paused, so no job runs against the sale being rebuilt. The caller must call
   * resumeProcessing once the new sale state is written, whether or not the rebuild succeeded.
   */
  async discardSaleOrders(saleId: string): Promise<void> {
    await this.queue.pause();
    await this.waitForActiveJobs();
    await this.queue.drain(true);
    await this.ordersRepository.deleteBySale(saleId);
  }

  async resumeProcessing(): Promise<void> {
    await this.queue.resume();
  }

  /** Closed in the destroy phase, before RedisModule quits at application shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  private async isJobStored(jobId: string): Promise<boolean> {
    try {
      return Boolean(await this.queue.getJob(jobId));
    } catch {
      return false;
    }
  }

  private async isReservationLive(ref: ReservationRef): Promise<boolean> {
    const slot = await this.orderCache.findSlot(ref.saleId, ref.userId);
    return slot.status !== 'NONE' && slot.orderId === ref.orderId;
  }

  private async waitForActiveJobs(): Promise<void> {
    let waitedMs = 0;
    while ((await this.queue.getActiveCount()) > 0) {
      if (waitedMs >= RESET_ACTIVE_JOBS_TIMEOUT_MS) {
        throw new ServiceUnavailableException({
          code: ERROR_CODES.TEMPORARY_FAILURE,
          message: TEMPORARY_FAILURE_MESSAGE,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, RESET_ACTIVE_JOBS_POLL_MS));
      waitedMs += RESET_ACTIVE_JOBS_POLL_MS;
    }
  }
}
