import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module';
import { QueueModule } from '../../src/infrastructure/queue/queue.module';

describe('QueueModule', () => {
  const queueName = `test-queue-${randomUUID()}`;
  let moduleRef: TestingModule;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, QueueModule, BullModule.registerQueue({ name: queueName })],
    }).compile();
    await moduleRef.init();
    queue = moduleRef.get<Queue>(getQueueToken(queueName));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('stores a job that can be read back by id', async () => {
    const job = await queue.add('probe', { orderId: 'o-1' });

    const found = await queue.getJob(job.id as string);

    expect(found?.data).toEqual({ orderId: 'o-1' });
  });

  it('connects the queue client to the configured REDIS_PORT', async () => {
    const client = await queue.client;

    expect(client.options.port).toBe(Number(process.env.REDIS_PORT));
  });
});
