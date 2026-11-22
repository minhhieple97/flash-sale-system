import type { Queue } from 'bullmq';
import { ORDER_PERSISTENCE_PRODUCER } from '../../src/infrastructure/queue/queue.constants';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { flashSaleStockKey } from '../support/ledger-keys';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';
import { waitFor } from '../support/wait-for';

const WORKER_TIMEOUT_MS = 10000;

describe('a purchase whose enqueue reply is lost after the job was stored', () => {
  let harness: RealSaleHarness;
  let producer: Queue<ReservationRef>;

  beforeAll(async () => {
    harness = await createRealSaleHarness();
    producer = harness.moduleRef.get<Queue<ReservationRef>>(ORDER_PERSISTENCE_PRODUCER, {
      strict: false,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('answers QUEUED when queue.add stored the job but its reply was lost', async () => {
    await harness.resetService.reset({ totalStock: 3, startsOffsetSeconds: -60 });
    const realAdd = producer.add.bind(producer);
    jest.spyOn(producer, 'add').mockImplementationOnce(async (name, data, options) => {
      const job = await realAdd(name, data, options);
      await waitFor(
        () => producer.getJob(String(job.id)),
        (stored) => stored === undefined,
        { timeoutMs: WORKER_TIMEOUT_MS },
      );
      throw new Error('Connection is closed (reply lost after the job was stored and completed)');
    });
    const userId = userIdOf('alice');

    const attempt = harness.checkout.attemptPurchase(userId);

    await expect(attempt).resolves.toMatchObject({ outcome: 'RESERVED', userId });
    expect(await harness.ledger.findSlot(ACTIVE_FLASH_SALE_ID, userId)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(await harness.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID))).toBe('2');
  }, 30000);
});
