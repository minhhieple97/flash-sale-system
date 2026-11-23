import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { type ConnectionOptions, type Queue, Worker } from 'bullmq';
import { ClockService } from '../../src/common/providers/clock.service';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import { QueueModule } from '../../src/infrastructure/queue/queue.module';
import {
  ORDER_PERSISTENCE_JOB_NAME,
  ORPHAN_GRACE_MS,
} from '../../src/modules/orders/constants/orders.constants';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { OrphanSweeper } from '../../src/modules/orders/services/orphan-sweeper.service';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { START_MS } from '../support/flash-sale.fixtures';
import { flashSaleStockKey } from '../support/ledger-keys';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';

const STOCK = 2;
const NONE_COMPENSATED = { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 };

describe('OrphanSweeper on the real queue', () => {
  let ledgerHarness: SaleLedgerHarness;
  let db: SaleDbHarness;
  let moduleRef: TestingModule;
  let queue: Queue<ReservationRef>;
  let driver: Worker<ReservationRef>;
  let ordersRepository: OrdersRepository;
  let persistence: OrderPersistenceService;
  const jobIds: string[] = [];

  beforeAll(async () => {
    ledgerHarness = await createSaleLedgerHarness();
    db = await createSaleDbHarness();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        DatabaseModule,
        QueueModule,
        BullModule.registerQueue({ name: ORDER_PERSISTENCE_QUEUE }),
      ],
      providers: [OrdersRepository],
    }).compile();
    await moduleRef.init();
    queue = moduleRef.get<Queue<ReservationRef>>(getQueueToken(ORDER_PERSISTENCE_QUEUE));
    await queue.resume();
    driver = new Worker<ReservationRef>(ORDER_PERSISTENCE_QUEUE, undefined, {
      connection: queue.opts.connection as ConnectionOptions,
      autorun: false,
    });
    ordersRepository = moduleRef.get(OrdersRepository);
    persistence = new OrderPersistenceService(
      queue,
      ordersRepository,
      ledgerHarness.ledger,
      new ClockService(),
    );
  });

  const newSweeper = (nowMs = START_MS): OrphanSweeper =>
    new OrphanSweeper(persistence, ledgerHarness.ledger, { nowMs: () => nowMs } as ClockService);

  afterAll(async () => {
    for (const jobId of jobIds) await (await queue.getJob(jobId))?.remove();
    await driver.close();
    await queue.close();
    await moduleRef.close();
    await db.close();
    await ledgerHarness.close();
  });

  async function reserveInFreshSale(): Promise<ReservationRef> {
    const saleId = await ledgerHarness.seedSale(STOCK);
    await db.seedSale(saleId, STOCK);
    return ledgerHarness.reserve(saleId, 'alice');
  }

  async function enqueuePersistence(ref: ReservationRef): Promise<void> {
    jobIds.push(ref.orderId);
    await queue.add(ORDER_PERSISTENCE_JOB_NAME, ref, {
      jobId: ref.orderId,
      attempts: 1,
      lifo: true,
    });
  }

  /** `lifo` puts the job at the head of the wait list, so the driver takes this job and no other. */
  async function failPersistenceJob(ref: ReservationRef): Promise<void> {
    await enqueuePersistence(ref);
    const token = randomUUID();
    const job = await driver.getNextJob(token, { block: false });
    if (job?.id !== ref.orderId) throw new Error(`driver took job ${job?.id}, not ${ref.orderId}`);
    await job.moveToFailed(new Error('retries exhausted'), token, false);
  }

  const redisStockOf = async (saleId: string): Promise<number> =>
    Number(await ledgerHarness.redis.get(flashSaleStockKey(saleId)));

  it('releases a reservation that never got a job and returns its unit to the stock', async () => {
    const ref = await reserveInFreshSale();

    const summary = await newSweeper().sweepOrphans(ref.saleId, 0);

    expect(summary).toEqual({
      pending: 0,
      compensated: { ...NONE_COMPENSATED, RELEASED: 1 },
    });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK);
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({ status: 'NONE' });
  });

  it('leaves a reservation whose persistence job is still waiting untouched', async () => {
    const ref = await reserveInFreshSale();
    await enqueuePersistence(ref);

    const summary = await newSweeper().sweepOrphans(ref.saleId, 0);

    expect(summary).toEqual({ pending: 1, compensated: NONE_COMPENSATED });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK - 1);
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({
      status: 'RESERVED',
      orderId: ref.orderId,
    });
  });

  it('confirms an orphan whose order PostgreSQL already holds and keeps its unit sold', async () => {
    const ref = await reserveInFreshSale();
    await ordersRepository.persistConfirmedOrder(ref);

    const summary = await newSweeper().sweepOrphans(ref.saleId, 0);

    expect(summary).toEqual({
      pending: 0,
      compensated: { ...NONE_COMPENSATED, CONFIRMED: 1 },
    });
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({
      status: 'CONFIRMED',
      orderId: ref.orderId,
    });
    expect(await redisStockOf(ref.saleId)).toBe(await db.stockOf(ref.saleId));
  });

  it('compensates a reservation whose persistence job failed with no compensation job queued', async () => {
    const ref = await reserveInFreshSale();
    await failPersistenceJob(ref);
    expect(await queue.getJobState(ref.orderId)).toBe('failed');

    const summary = await newSweeper().sweepOrphans(ref.saleId, 0);

    expect(summary).toEqual({
      pending: 0,
      compensated: { ...NONE_COMPENSATED, RELEASED: 1 },
    });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK);
    expect(await db.ordersOf(ref.saleId)).toEqual([]);
  });

  it('leaves a fresh jobless reservation alone within ORPHAN_GRACE_MS and releases it once expired', async () => {
    const ref = await reserveInFreshSale();

    await newSweeper(START_MS + ORPHAN_GRACE_MS - 1).sweepOrphans(ref.saleId);
    const slotWithinGrace = await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId);
    await newSweeper(START_MS + ORPHAN_GRACE_MS + 1).sweepOrphans(ref.saleId);

    expect(slotWithinGrace).toEqual({ status: 'RESERVED', orderId: ref.orderId });
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({ status: 'NONE' });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK);
  });

  it('keeps an entry whose job is added before the grace window expires', async () => {
    const ref = await reserveInFreshSale();

    await newSweeper(START_MS + 1_000).sweepOrphans(ref.saleId);
    await enqueuePersistence(ref);
    const afterGrace = await newSweeper(START_MS + ORPHAN_GRACE_MS + 1).sweepOrphans(ref.saleId);

    expect(afterGrace).toEqual({ pending: 1, compensated: NONE_COMPENSATED });
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({
      status: 'RESERVED',
      orderId: ref.orderId,
    });
    expect(await redisStockOf(ref.saleId)).toBe(STOCK - 1);
  });
});
