import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { temporaryFailure } from '../../../common/errors/temporary-failure.error';
import { ClockService } from '../../../common/providers/clock.service';
import { closeProducerQueue } from '../../../infrastructure/queue/order-persistence-producer.provider';
import { ORDER_PERSISTENCE_PRODUCER } from '../../../infrastructure/queue/queue.constants';
import { MetricsService } from '../../metrics/services/metrics.service';
import { type ConfirmOutcome, type ReservationRef, SaleLedgerRepository } from '../../sale-ledger';
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
  ScheduleReservationOutcome,
} from '../interfaces/order.interface';
import { OrdersRepository } from '../repositories/orders.repository';

@Injectable()
export class OrderPersistenceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceService.name);

  constructor(
    @Inject(ORDER_PERSISTENCE_PRODUCER) private readonly queue: Queue<ReservationRef>,
    private readonly ordersRepository: OrdersRepository,
    private readonly ledger: SaleLedgerRepository,
    private readonly clock: ClockService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** The pause is global and stored in Redis: a reset that crashed before its resume would keep it. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.resume();
    this.metrics?.registerQueueCollector(() =>
      this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    );
  }

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
      return this.releaseUnscheduled(ref);
    }
  }

  async persistReservedOrder(ref: ReservationRef): Promise<PersistOrderResult> {
    try {
      const result = (await this.isReservationLive(ref))
        ? await this.persistLiveReservation(ref)
        : await this.adoptCommittedOrStale(ref);
      this.metrics?.recordOrderPersistence(result.outcome);
      return result;
    } catch (error) {
      this.metrics?.recordOrderPersistence('FAILED');
      throw error;
    }
  }

  async compensateFailedOrder(ref: ReservationRef): Promise<CompensationOutcome> {
    try {
      const storedOrderId = await this.ordersRepository.findConfirmedOrderId(
        ref.saleId,
        ref.userId,
      );
      const outcome =
        storedOrderId === null
          ? await this.ledger.releaseReservation(ref)
          : await this.confirmCommitted(ref, storedOrderId);
      this.metrics?.recordOrderPersistence(outcome);
      return outcome;
    } catch (error) {
      this.metrics?.recordOrderPersistence('FAILED');
      throw error;
    }
  }

  async scheduleCompensation(ref: ReservationRef): Promise<void> {
    await this.queue.add(ORDER_COMPENSATION_JOB_NAME, ref, {
      ...ORDER_COMPENSATION_JOB_OPTIONS,
      jobId: orderCompensationJobId(ref),
    });
  }

  async drainPendingJobs(): Promise<void> {
    await this.queue.pause();
    await this.waitForActiveJobs();
    await this.queue.drain(true);
  }

  async resumeProcessing(): Promise<void> {
    await this.queue.resume();
  }

  async hasPendingJob(ref: ReservationRef): Promise<boolean> {
    const jobIds = [orderPersistenceJobId(ref), orderCompensationJobId(ref)];
    const states = await Promise.all(jobIds.map((jobId) => this.queue.getJobState(jobId)));
    return states.some((state) => PENDING_JOB_STATES.has(state));
  }

  /** Closed in the destroy phase, before RedisModule quits at application shutdown. */
  async onModuleDestroy(): Promise<void> {
    await closeProducerQueue(this.queue);
  }

  private async releaseUnscheduled(ref: ReservationRef): Promise<ScheduleReservationOutcome> {
    if ((await this.ledger.releaseReservation(ref)) === 'RELEASED') return 'RELEASED';
    const slot = await this.ledger.findSlot(ref.saleId, ref.userId);
    return slot.status === 'CONFIRMED' ? 'QUEUED' : 'RELEASED';
  }

  private async persistLiveReservation(ref: ReservationRef): Promise<PersistOrderResult> {
    const result = await this.ordersRepository.persistConfirmedOrder(ref);
    await this.confirmCommitted(ref, result.orderId);
    return result;
  }

  private async adoptCommittedOrStale(ref: ReservationRef): Promise<PersistOrderResult> {
    const storedOrderId = await this.ordersRepository.findConfirmedOrderId(ref.saleId, ref.userId);
    if (storedOrderId !== ref.orderId) return { outcome: 'STALE', orderId: ref.orderId };
    await this.confirmCommitted(ref, storedOrderId);
    return { outcome: 'ALREADY_PERSISTED', orderId: storedOrderId };
  }

  private async confirmCommitted(ref: ReservationRef, orderId: string): Promise<ConfirmOutcome> {
    if ((await this.ledger.confirmReservation(ref, orderId)) === 'CONFIRMED') return 'CONFIRMED';
    const order = { ...ref, orderId };
    if ((await this.ledger.adoptCommittedOrder(order)) === 'ADOPTED') {
      this.logger.warn(`Order ${orderId} committed after its entry was lost; adopted it`);
      return 'CONFIRMED';
    }
    if (!(await this.ledger.isIntact(ref.saleId))) {
      throw new Error(`Sale ${ref.saleId} ledger is rebuilding; retrying adoption for ${orderId}`);
    }
    this.logger.error(
      `Order ${orderId} committed but reservation ${ref.orderId} cannot be confirmed or adopted`,
    );
    return 'NOT_RESERVED';
  }

  private async isJobStored(jobId: string): Promise<boolean> {
    try {
      return Boolean(await this.queue.getJob(jobId));
    } catch {
      return false;
    }
  }

  private async isReservationLive(ref: ReservationRef): Promise<boolean> {
    const slot = await this.ledger.findSlot(ref.saleId, ref.userId);
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
