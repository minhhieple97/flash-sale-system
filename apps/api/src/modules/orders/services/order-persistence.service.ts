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
import { formatRequestTag } from '../../../common/utils/request-id.util';
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
  OrderJobData,
  PersistOrderResult,
  ScheduleReservationOutcome,
} from '../interfaces/order.interface';
import { OrdersRepository } from '../repositories/orders.repository';

function toReservationRef({ saleId, userId, orderId }: OrderJobData): ReservationRef {
  return { saleId, userId, orderId };
}

@Injectable()
export class OrderPersistenceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceService.name);

  constructor(
    @Inject(ORDER_PERSISTENCE_PRODUCER) private readonly queue: Queue<OrderJobData>,
    private readonly ordersRepository: OrdersRepository,
    private readonly ledger: SaleLedgerRepository,
    private readonly clock: ClockService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Queue resume is fenced under the distributed maintenance lease in LedgerMaintenanceService. */
  onApplicationBootstrap(): void {
    this.metrics?.registerQueueCollector(() =>
      this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    );
  }

  async scheduleReservation(jobData: OrderJobData): Promise<ScheduleReservationOutcome> {
    const jobId = orderPersistenceJobId(jobData);
    try {
      await this.queue.add(ORDER_PERSISTENCE_JOB_NAME, jobData, {
        ...ORDER_PERSISTENCE_JOB_OPTIONS,
        jobId,
      });
      return 'QUEUED';
    } catch (error) {
      this.logger.warn(
        `${formatRequestTag(jobData.requestId)}Enqueue failed for order ${jobData.orderId}: ${String(error)}`,
      );
      if (await this.isJobStored(jobId)) return 'QUEUED';
      return this.releaseUnscheduled(toReservationRef(jobData));
    }
  }

  async persistReservedOrder(jobData: OrderJobData): Promise<PersistOrderResult> {
    try {
      const result = (await this.isReservationLive(jobData))
        ? await this.persistLiveReservation(jobData)
        : await this.adoptCommittedOrStale(jobData);
      this.metrics?.recordOrderPersistence(result.outcome);
      return result;
    } catch (error) {
      this.metrics?.recordOrderPersistence('FAILED');
      throw error;
    }
  }

  async compensateFailedOrder(jobData: OrderJobData): Promise<CompensationOutcome> {
    try {
      const storedOrderId = await this.ordersRepository.findConfirmedOrderId(
        jobData.saleId,
        jobData.userId,
      );
      const outcome =
        storedOrderId === null
          ? await this.ledger.releaseReservation(toReservationRef(jobData))
          : await this.confirmCommitted(jobData, storedOrderId);
      this.metrics?.recordOrderPersistence(outcome);
      return outcome;
    } catch (error) {
      this.metrics?.recordOrderPersistence('FAILED');
      throw error;
    }
  }

  async scheduleCompensation(jobData: OrderJobData): Promise<void> {
    await this.queue.add(ORDER_COMPENSATION_JOB_NAME, jobData, {
      ...ORDER_COMPENSATION_JOB_OPTIONS,
      jobId: orderCompensationJobId(jobData),
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

  private async persistLiveReservation(jobData: OrderJobData): Promise<PersistOrderResult> {
    const result = await this.ordersRepository.persistConfirmedOrder(toReservationRef(jobData));
    await this.confirmCommitted(jobData, result.orderId);
    return result;
  }

  private async adoptCommittedOrStale(jobData: OrderJobData): Promise<PersistOrderResult> {
    const storedOrderId = await this.ordersRepository.findConfirmedOrderId(
      jobData.saleId,
      jobData.userId,
    );
    if (storedOrderId !== jobData.orderId) return { outcome: 'STALE', orderId: jobData.orderId };
    await this.confirmCommitted(jobData, storedOrderId);
    return { outcome: 'ALREADY_PERSISTED', orderId: storedOrderId };
  }

  private async confirmCommitted(jobData: OrderJobData, orderId: string): Promise<ConfirmOutcome> {
    const ref = toReservationRef(jobData);
    if ((await this.ledger.confirmReservation(ref, orderId)) === 'CONFIRMED') return 'CONFIRMED';
    const order = { ...ref, orderId };
    if ((await this.ledger.adoptCommittedOrder(order)) === 'ADOPTED') {
      this.logger.warn(
        `${formatRequestTag(jobData.requestId)}Order ${orderId} committed after its entry was lost; adopted it`,
      );
      return 'CONFIRMED';
    }
    if (!(await this.ledger.isIntact(ref.saleId))) {
      throw new Error(`Sale ${ref.saleId} ledger is rebuilding; retrying adoption for ${orderId}`);
    }
    this.logger.error(
      `${formatRequestTag(jobData.requestId)}Order ${orderId} committed but reservation ${ref.orderId} cannot be confirmed or adopted`,
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
