import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { AppConfigModule } from '../../src/config/app-config.module';
import {
  closeProducerQueue,
  orderPersistenceProducerProvider,
} from '../../src/infrastructure/queue/order-persistence-producer.provider';
import { ORDER_PERSISTENCE_PRODUCER } from '../../src/infrastructure/queue/queue.constants';

const RECONNECT_BUDGET_MS = 300;

describe('order persistence producer', () => {
  let moduleRef: TestingModule;
  let queue: Queue;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [orderPersistenceProducerProvider],
    }).compile();
    queue = moduleRef.get<Queue>(ORDER_PERSISTENCE_PRODUCER);
  });

  afterEach(async () => {
    await closeProducerQueue(queue);
    await moduleRef.close();
  });

  it('closes its client when Redis is reachable', async () => {
    const client = (await queue.client) as unknown as Redis;

    await closeProducerQueue(queue);

    expect(client.status).toBe('end');
  });

  it('does not throw on close while its client is reconnecting', async () => {
    // BullMQ types the client as its own adapter interface, which omits the EventEmitter methods.
    const client = (await queue.client) as unknown as Redis;
    const reconnectScheduled = once(client, 'reconnecting');
    client.disconnect(true);
    await reconnectScheduled;

    const closed = closeProducerQueue(queue);

    await expect(closed).resolves.toBeUndefined();
  });

  it('reconnects within 300 ms after its connection drops', async () => {
    const client = (await queue.client) as unknown as Redis;
    const reconnected = once(client, 'ready');
    const started = performance.now();

    client.disconnect(true);
    await reconnected;

    expect(performance.now() - started).toBeLessThan(RECONNECT_BUDGET_MS);
  });
});
