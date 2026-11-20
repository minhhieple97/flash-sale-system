import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ORDER_PERSISTENCE_QUEUE } from '../../../infrastructure/queue/queue.constants';
import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_PERSISTENCE_CONCURRENCY,
  ORDER_PERSISTENCE_JOB_NAME,
} from '../constants/orders.constants';
import type { OrderJobResult, ReservationRef } from '../interfaces/order.interface';
import { OrderPersistenceService } from '../services/order-persistence.service';

type OrderJobHandler = (ref: ReservationRef) => Promise<OrderJobResult>;

/** Thin BullMQ worker: every decision lives in OrderPersistenceService. */
@Processor(ORDER_PERSISTENCE_QUEUE, { concurrency: ORDER_PERSISTENCE_CONCURRENCY })
export class OrderPersistenceProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceProcessor.name);
  private readonly handlers: ReadonlyMap<string, OrderJobHandler>;

  constructor(private readonly persistence: OrderPersistenceService) {
    super();
    this.handlers = new Map<string, OrderJobHandler>([
      [ORDER_PERSISTENCE_JOB_NAME, (ref) => this.persistence.persistReservedOrder(ref)],
      [ORDER_COMPENSATION_JOB_NAME, (ref) => this.persistence.compensateFailedOrder(ref)],
    ]);
  }

  async process(job: Job<ReservationRef>): Promise<OrderJobResult> {
    const handler = this.handlers.get(job.name);
    if (handler === undefined) throw new Error(`Unknown order job name: ${job.name}`);
    return handler(job.data);
  }

  /**
   * BullMQ emits `failed` after every attempt, so only the last one counts. A rejection inside a
   * BullMQ event listener is unhandled, so every failure here is logged instead.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ReservationRef> | undefined): Promise<void> {
    if (job === undefined || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const { orderId } = job.data;
    if (job.name === ORDER_COMPENSATION_JOB_NAME) {
      this.logger.error(
        `Compensation for order ${orderId} exhausted its retries; the reservation stays held until a reset`,
      );
      return;
    }
    if (job.name !== ORDER_PERSISTENCE_JOB_NAME) return;
    try {
      await this.persistence.scheduleCompensation(job.data);
    } catch (error) {
      this.logger.error(`Could not schedule compensation for order ${orderId}: ${String(error)}`);
    }
  }

  /** Without a listener, a worker `error` event (a lost connection, a missing job key) is unhandled. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Order persistence worker error: ${error.message}`);
  }

  /** Waits for in-flight jobs in the destroy phase, before RedisModule quits at shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
