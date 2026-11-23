import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { formatRequestTag } from '../../../common/utils/request-id.util';
import { ORDER_PERSISTENCE_QUEUE } from '../../../infrastructure/queue/queue.constants';
import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_PERSISTENCE_CONCURRENCY,
  ORDER_PERSISTENCE_JOB_NAME,
} from '../constants/orders.constants';
import { OrderPersistenceRejectedError } from '../errors/order-persistence-rejected.error';
import type { OrderJobData, OrderJobResult } from '../interfaces/order.interface';
import { OrderPersistenceService } from '../services/order-persistence.service';

interface OrderJobHandler {
  run(jobData: OrderJobData): Promise<OrderJobResult>;
  /** Called once the job failed for good. Must not reject: it runs inside a BullMQ event listener. */
  onExhausted(jobData: OrderJobData): Promise<void>;
}

/**
 * BullMQ fails a job without retrying it on an UnrecoverableError: a deterministic rejection mapped
 * in process, or a job stalled too many times.
 */
function isFinalFailure(job: Job<OrderJobData>, error: Error): boolean {
  return error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
}

@Processor(ORDER_PERSISTENCE_QUEUE, { concurrency: ORDER_PERSISTENCE_CONCURRENCY })
export class OrderPersistenceProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OrderPersistenceProcessor.name);
  private readonly handlers: ReadonlyMap<string, OrderJobHandler>;

  constructor(private readonly persistence: OrderPersistenceService) {
    super();
    this.handlers = new Map<string, OrderJobHandler>([
      [
        ORDER_PERSISTENCE_JOB_NAME,
        {
          run: (jobData) => this.persistence.persistReservedOrder(jobData),
          onExhausted: (jobData) => this.scheduleCompensation(jobData),
        },
      ],
      [
        ORDER_COMPENSATION_JOB_NAME,
        {
          run: (jobData) => this.persistence.compensateFailedOrder(jobData),
          onExhausted: async ({ orderId, requestId }) =>
            this.logger.error(
              `${formatRequestTag(requestId)}Compensation for order ${orderId} exhausted its retries; the orphan sweeper retries it after the pending grace window`,
            ),
        },
      ],
    ]);
  }

  async process(job: Job<OrderJobData>): Promise<OrderJobResult> {
    const handler = this.handlers.get(job.name);
    if (handler === undefined) throw new Error(`Unknown order job name: ${job.name}`);
    try {
      return await handler.run(job.data);
    } catch (error) {
      if (error instanceof OrderPersistenceRejectedError)
        throw new UnrecoverableError(error.message);
      throw error;
    }
  }

  /**
   * BullMQ emits `failed` after every attempt, so only a final failure counts. A rejection inside a
   * BullMQ event listener is unhandled, so every failure here is logged instead.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<OrderJobData> | undefined, error: Error): Promise<void> {
    if (job === undefined || !isFinalFailure(job, error)) return;
    await this.handlers.get(job.name)?.onExhausted(job.data);
  }

  private async scheduleCompensation(jobData: OrderJobData): Promise<void> {
    try {
      await this.persistence.scheduleCompensation(jobData);
    } catch (error) {
      this.logger.error(
        `${formatRequestTag(jobData.requestId)}Could not schedule compensation for order ${jobData.orderId}: ${String(error)}`,
      );
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
