import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ORDER_PERSISTENCE_QUEUE } from '../../../infrastructure/queue/queue.constants';
import { ORDER_PERSISTENCE_CONCURRENCY } from '../constants/orders.constants';
import type { PersistOrderResult, ReservationRef } from '../interfaces/order.interface';
import { OrderPersistenceService } from '../services/order-persistence.service';

/** Thin BullMQ worker: every decision lives in OrderPersistenceService. */
@Processor(ORDER_PERSISTENCE_QUEUE, { concurrency: ORDER_PERSISTENCE_CONCURRENCY })
export class OrderPersistenceProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceProcessor.name);

  constructor(private readonly persistence: OrderPersistenceService) {
    super();
  }

  async process(job: Job<ReservationRef>): Promise<PersistOrderResult> {
    return this.persistence.persistReservedOrder(job.data);
  }

  /**
   * BullMQ emits `failed` after every attempt, so compensation waits for the last one.
   * A rejection inside a BullMQ event listener is unhandled, so a failed compensation is logged.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ReservationRef> | undefined): Promise<void> {
    if (job === undefined || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await this.persistence.compensateFailedOrder(job.data);
    } catch (error) {
      this.logger.error(`Compensation failed for order ${job.data.orderId}: ${String(error)}`);
    }
  }

  /** Waits for in-flight jobs in the destroy phase, before RedisModule quits at shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
