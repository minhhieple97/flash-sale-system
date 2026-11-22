import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { ORDER_PERSISTENCE_QUEUE } from '../../src/infrastructure/queue/queue.constants';
import {
  CONFIRMED_ORDER_STATUS,
  ORDER_PERSISTENCE_CONCURRENCY,
  ORDER_PERSISTENCE_JOB_OPTIONS,
  orderCompensationJobId,
  orderPersistenceJobId,
} from '../../src/modules/orders/constants/orders.constants';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type { ReservationRef, ReservationSlot } from '../../src/modules/sale-ledger';
import { createAppTestingModule } from '../support/app-module.testing';
import { expectLedgerConverged } from '../support/ledger-convergence';
import { flashSaleStockKey, flashSaleUsersKey } from '../support/ledger-keys';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';
import { waitFor } from '../support/wait-for';

const STOCK = 5;
const FAILURE_TIMEOUT_MS = 15000;
const FAST_RETRY_DELAY_MS = 10;
const CONNECTION_REFUSALS = 6;

function connectionRefused(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
}

describe('order persistence pipeline (real worker)', () => {
  let app: TestingModule;
  let queue: Queue<ReservationRef>;
  let processor: OrderPersistenceProcessor;
  let persistence: OrderPersistenceService;
  let ordersRepository: OrdersRepository;
  let ledgerHarness: SaleLedgerHarness;
  let db: SaleDbHarness;
  const refs: ReservationRef[] = [];

  async function reserveOnNewSale(): Promise<ReservationRef> {
    const saleId = await ledgerHarness.seedSale(STOCK);
    await db.seedSale(saleId, STOCK);
    return reserveFor(saleId);
  }

  async function reserveFor(saleId: string): Promise<ReservationRef> {
    const ref = await ledgerHarness.reserve(saleId, `buyer-${randomUUID()}`);
    refs.push(ref);
    return ref;
  }

  const slotOf = (ref: ReservationRef): Promise<ReservationSlot> =>
    ledgerHarness.ledger.findSlot(ref.saleId, ref.userId);

  beforeAll(async () => {
    ledgerHarness = await createSaleLedgerHarness();
    db = await createSaleDbHarness();
    app = await createAppTestingModule().compile();
    await app.init();
    queue = app.get<Queue<ReservationRef>>(getQueueToken(ORDER_PERSISTENCE_QUEUE), {
      strict: false,
    });
    processor = app.get(OrderPersistenceProcessor, { strict: false });
    persistence = app.get(OrderPersistenceService, { strict: false });
    ordersRepository = app.get(OrdersRepository, { strict: false });
  });

  let refsBeforeTest = 0;

  beforeEach(() => {
    refsBeforeTest = refs.length;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const saleIds = new Set(refs.slice(refsBeforeTest).map((ref) => ref.saleId));
    for (const saleId of saleIds) await expectLedgerConverged(app, { saleId, totalStock: STOCK });
  });

  afterAll(async () => {
    for (const ref of refs) {
      await (await queue.getJob(orderPersistenceJobId(ref)))?.remove();
      await (await queue.getJob(orderCompensationJobId(ref)))?.remove();
    }
    await app.close();
    await db.close();
    await ledgerHarness.close();
  });

  it('builds the worker with the configured concurrency', () => {
    expect(processor.worker.opts.concurrency).toBe(ORDER_PERSISTENCE_CONCURRENCY);
  });

  it('turns a reservation into a CONFIRMED order and decrements stock once', async () => {
    const ref = await reserveOnNewSale();

    const outcome = await persistence.scheduleReservation(ref);
    const slot = await waitFor(
      () => slotOf(ref),
      (value) => value.status === 'CONFIRMED',
    );

    expect(outcome).toBe('QUEUED');
    expect(slot).toEqual({ status: 'CONFIRMED', orderId: ref.orderId });
    expect(await db.ordersOf(ref.saleId)).toEqual([
      { id: ref.orderId, user_id: ref.userId, status: CONFIRMED_ORDER_STATUS },
    ]);
    expect(await db.stockOf(ref.saleId)).toBe(STOCK - 1);
  });

  it(
    'keeps a 202 when PostgreSQL refuses connections for longer than the old retry budget',
    async () => {
      const ref = await reserveOnNewSale();
      jest.replaceProperty(ORDER_PERSISTENCE_JOB_OPTIONS.backoff, 'delay', FAST_RETRY_DELAY_MS);
      const persist = jest.spyOn(ordersRepository, 'persistConfirmedOrder');
      for (let refusal = 0; refusal < CONNECTION_REFUSALS; refusal += 1) {
        persist.mockRejectedValueOnce(connectionRefused());
      }

      await persistence.scheduleReservation(ref);
      const slot = await waitFor(
        () => slotOf(ref),
        (value) => value.status === 'CONFIRMED',
        { timeoutMs: FAILURE_TIMEOUT_MS },
      );

      const orders = await db.ordersOf(ref.saleId);
      const redisStock = Number(await ledgerHarness.redis.get(flashSaleStockKey(ref.saleId)));
      expect(slot).toEqual({ status: 'CONFIRMED', orderId: ref.orderId });
      expect(orders).toHaveLength(1);
      expect(redisStock + orders.length).toBe(STOCK);
      expect(persist).toHaveBeenCalledTimes(CONNECTION_REFUSALS + 1);
    },
    FAILURE_TIMEOUT_MS + 5000,
  );

  it(
    'compensates a deterministic rejection after one attempt, leaving no ghost entry',
    async () => {
      const saleId = await ledgerHarness.seedSale(STOCK);
      await db.seedSale(saleId, STOCK);
      await db.deleteSale(saleId);
      const ref = await reserveFor(saleId);
      const attemptsMade: number[] = [];
      const record = (job: Job<ReservationRef> | undefined): void => {
        if (job?.data.orderId === ref.orderId) attemptsMade.push(job.attemptsMade);
      };
      processor.worker.on('failed', record);

      await persistence.scheduleReservation(ref);
      const stock = await waitFor(
        () => ledgerHarness.redis.get(flashSaleStockKey(saleId)),
        (value) => value === String(STOCK),
        { timeoutMs: FAILURE_TIMEOUT_MS },
      );
      processor.worker.off('failed', record);

      expect(stock).toBe(String(STOCK));
      expect(await ledgerHarness.redis.hexists(flashSaleUsersKey(saleId), ref.userId)).toBe(0);
      expect(attemptsMade).toEqual([1]);
    },
    FAILURE_TIMEOUT_MS + 5000,
  );
});
