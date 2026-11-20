import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import { QueueModule } from '../../src/infrastructure/queue/queue.module';
import { ORDER_PERSISTENCE_JOB_NAME } from '../../src/modules/orders/constants/orders.constants';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import { OrderCacheRepository } from '../../src/modules/orders/repositories/order-cache.repository';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { userIdOf } from '../support/user-id.fixtures';

function newRef(): ReservationRef {
  return { saleId: randomUUID(), userId: userIdOf('alice'), orderId: randomUUID() };
}

describe('OrderPersistenceService against the real order-persistence queue', () => {
  let moduleRef: TestingModule;
  let queue: Queue<ReservationRef>;
  let service: OrderPersistenceService;
  const releaseReservation = jest.fn();
  const createdOrderIds: string[] = [];

  function track(ref: ReservationRef): ReservationRef {
    createdOrderIds.push(ref.orderId);
    return ref;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        QueueModule,
        BullModule.registerQueue({ name: ORDER_PERSISTENCE_QUEUE }),
      ],
      providers: [
        OrderPersistenceService,
        { provide: OrdersRepository, useValue: {} },
        { provide: OrderCacheRepository, useValue: { releaseReservation } },
      ],
    }).compile();
    await moduleRef.init();
    queue = moduleRef.get<Queue<ReservationRef>>(getQueueToken(ORDER_PERSISTENCE_QUEUE));
    service = moduleRef.get(OrderPersistenceService);
  });

  afterAll(async () => {
    for (const orderId of createdOrderIds) {
      await (await queue.getJob(orderId))?.remove();
    }
    await moduleRef.close();
  });

  it('queues the reservation as a job addressable by its orderId', async () => {
    const ref = track(newRef());

    const outcome = await service.scheduleReservation(ref);

    expect(outcome).toBe('QUEUED');
    const job = await queue.getJob(ref.orderId);
    expect(job?.data).toEqual(ref);
    expect(job?.name).toBe(ORDER_PERSISTENCE_JOB_NAME);
  });

  it('leaves exactly one job when the same reservation is scheduled twice', async () => {
    const ref = track(newRef());

    await service.scheduleReservation(ref);
    const secondOutcome = await service.scheduleReservation(ref);

    const waiting = await queue.getJobs(['waiting']);
    expect(secondOutcome).toBe('QUEUED');
    expect(waiting.filter((job) => job.data.orderId === ref.orderId)).toHaveLength(1);
  });

  it('shows why the orderId is the job id: BullMQ refuses a colon-separated custom id', async () => {
    const ref = newRef();

    const enqueue = queue.add(ORDER_PERSISTENCE_JOB_NAME, ref, {
      jobId: `${ref.saleId}:${ref.userId}`,
    });

    await expect(enqueue).rejects.toThrow(/Custom Id cannot contain :/);
  });
});
