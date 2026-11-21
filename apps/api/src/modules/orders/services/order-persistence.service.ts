import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { temporaryFailure } from '../../../common/errors/temporary-failure.error';
import { ClockService } from '../../../common/providers/clock.service';
import { ORDER_PERSISTENCE_QUEUE } from '../../../infrastructure/queue/queue.constants';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_COMPENSATION_JOB_OPTIONS,
  ORDER_PERSISTENCE_JOB_NAME,
  ORDER_PERSISTENCE_JOB_OPTIONS,
  orderCompensationJobId,
  orderPersistenceJobId,
  PENDING_JOB_STATES,
  RESET_ACTIVE_JOBS_POLL_MS,
  RESET_ACTIVE_JOBS_TIMEOUT_MS,
} from '../constants/orders.constants';
import type {
  CompensationOutcome,
  PersistOrderResult,
  ReconciliationSummary,
  ReservationRef,
  ScheduleReservationOutcome,
} from '../interfaces/order.interface';
import { OrderCacheRepository } from '../repositories/order-cache.repository';
import { OrdersRepository } from '../repositories/orders.repository';

/**
 * Reservation -> durable order pipeline, and its self-healing. Owns the invariant: every RESERVED
 * entry either has a persistence job or is released, and a job whose entry is gone writes nothing.
 * Paths that skip both (a lost enqueue reply, a crash after the Lua step, spent retries) are healed
 * by the boot reconciliation. Exported by OrdersModule.
 */
@Injectable()
export class OrderPersistenceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceService.name);

  constructor(
    @InjectQueue(ORDER_PERSISTENCE_QUEUE) private readonly queue: Queue<ReservationRef>,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderCache: OrderCacheRepository,
    private readonly clock: ClockService,
  ) {}

  /**
   * The pause is global and stored in Redis: a reset that crashed before its resume would keep it.
   * Runs before the HTTP listener opens, so no purchase of this instance is in flight.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.resume();
    await this.reconcileOrphanedReservations(ACTIVE_FLASH_SALE_ID);
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

  /**
   * Compensates every RESERVED entry with no persistence or compensation job left to run. Safe only
   * while no purchase can enqueue a job for the sale: at boot, with a single API instance.
   */
  async reconcileOrphanedReservations(saleId: string): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      pending: 0,
      orphans: { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 },
    };
    for (const ref of await this.orderCache.listReservations(saleId)) {
      if (await this.hasPendingJob(ref)) summary.pending += 1;
      else summary.orphans[await this.compensateFailedOrder(ref)] += 1;
    }
    if (Object.values(summary.orphans).some((count) => count > 0)) {
      this.logger.warn(
        `Reconciled orphaned reservations of sale ${saleId}: ${JSON.stringify(summary)}`,
      );
    }
    return summary;
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

  private async hasPendingJob(ref: ReservationRef): Promise<boolean> {
    const jobIds = [orderPersistenceJobId(ref), orderCompensationJobId(ref)];
    const states = await Promise.all(jobIds.map((jobId) => this.queue.getJobState(jobId)));
    return states.some((state) => PENDING_JOB_STATES.has(state));
  }

  private async isReservationLive(ref: ReservationRef): Promise<boolean> {
    const slot = await this.orderCache.findSlot(ref.saleId, ref.userId);
    return slot.status !== 'NONE' && slot.orderId === ref.orderId;
  }

  private async waitForActiveJobs(): Promise<void> {
    const deadlineMs = this.clock.nowMs() + RESET_ACTIVE_JOBS_TIMEOUT_MS;
    while ((await this.queue.getActiveCount()) > 0) {
      if (this.clock.nowMs() >= deadlineMs) throw temporaryFailure();
      await new Promise<void>((resolve) => setTimeout(resolve, RESET_ACTIVE_JOBS_POLL_MS));
    }
  }
}
