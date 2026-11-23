import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { AppEnv } from '../../config/env.interface';
import { queueProducerRedisOptions } from '../redis/redis-connection.options';
import { ORDER_PERSISTENCE_PRODUCER, ORDER_PERSISTENCE_QUEUE } from './queue.constants';

const producerLogger = new Logger('OrderPersistenceProducer');

/**
 * `@nestjs/bullmq` builds the worker from the registered queue's connection, so the producer needs
 * a Queue of its own to get different client options.
 */
export const orderPersistenceProducerProvider: Provider = {
  provide: ORDER_PERSISTENCE_PRODUCER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppEnv, true>): Queue => {
    const queue = new Queue(ORDER_PERSISTENCE_QUEUE, {
      connection: queueProducerRedisOptions(config),
    });
    queue.on('error', (error: Error) => {
      producerLogger.error(`Order persistence queue error: ${error.message || String(error)}`);
    });
    return queue;
  },
};

/**
 * QUIT needs a writable stream, and with the offline queue off a reconnecting client has none, so
 * BullMQ's close rejects. Dropping the client then also cancels its pending reconnect.
 */
export async function closeProducerQueue(queue: Queue): Promise<void> {
  try {
    await queue.close();
  } catch {
    (await queue.client).disconnect();
  }
}
