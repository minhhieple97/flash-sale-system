import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { ClockService } from '../../src/common/providers/clock.service';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { ORDER_PERSISTENCE_ATTEMPTS } from '../../src/modules/orders/constants/orders.constants';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { flashSaleStockKey } from '../support/ledger-keys';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';

/**
 * Compensation after a persistence job exhausted its retries, against real PostgreSQL and Redis.
 * No worker: the spec plays BullMQ's attempt loop by hand and injects the faults.
 */
describe('order compensation after exhausted retries', () => {
  let ledgerHarness: SaleLedgerHarness;
  let db: SaleDbHarness;
  let moduleRef: TestingModule;
  let ordersRepository: OrdersRepository;
  let service: OrderPersistenceService;

  beforeAll(async () => {
    ledgerHarness = await createSaleLedgerHarness();
    db = await createSaleDbHarness();
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [OrdersRepository],
    }).compile();
    await moduleRef.init();
    ordersRepository = moduleRef.get(OrdersRepository);
    service = new OrderPersistenceService(
      {} as unknown as Queue<ReservationRef>,
      ordersRepository,
      ledgerHarness.ledger,
      new ClockService(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef.close();
    await db.close();
    await ledgerHarness.close();
  });

  async function seedSoldOutCandidate(): Promise<ReservationRef> {
    const saleId = await ledgerHarness.seedSale(1);
    await db.seedSale(saleId, 1);
    return ledgerHarness.reserve(saleId, 'alice');
  }

  /** Every attempt rejects, as BullMQ would see it, before the job is handed to compensation. */
  async function exhaustAttempts(ref: ReservationRef): Promise<void> {
    for (let attempt = 1; attempt <= ORDER_PERSISTENCE_ATTEMPTS; attempt += 1) {
      await expect(service.persistReservedOrder(ref)).rejects.toThrow();
    }
  }

  const redisStockOf = async (saleId: string): Promise<number> =>
    Number(await ledgerHarness.redis.get(flashSaleStockKey(saleId)));

  it('confirms the stored order instead of releasing it when the commit landed but every CONFIRMED write was lost', async () => {
    const ref = await seedSoldOutCandidate();
    const lostConfirm = jest
      .spyOn(ledgerHarness.ledger, 'confirmReservation')
      .mockRejectedValue(new Error('redis connection dropped'));
    await exhaustAttempts(ref);
    lostConfirm.mockRestore();

    const outcome = await service.compensateFailedOrder(ref);

    expect(await redisStockOf(ref.saleId)).toBe(await db.stockOf(ref.saleId));
    expect(outcome).toBe('CONFIRMED');
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({
      status: 'CONFIRMED',
      orderId: ref.orderId,
    });
    await expect(ledgerHarness.reserve(ref.saleId, 'bob')).rejects.toThrow(
      'fixture reservation was SOLD_OUT',
    );
  });

  it('releases the reservation and restores stock when no order was ever committed', async () => {
    const ref = await seedSoldOutCandidate();
    jest
      .spyOn(ordersRepository, 'persistConfirmedOrder')
      .mockRejectedValue(new Error('db transient'));
    await exhaustAttempts(ref);

    const outcome = await service.compensateFailedOrder(ref);

    expect(outcome).toBe('RELEASED');
    expect(await redisStockOf(ref.saleId)).toBe(1);
    expect(await db.stockOf(ref.saleId)).toBe(1);
    expect(await db.ordersOf(ref.saleId)).toEqual([]);
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({ status: 'NONE' });
    await expect(ledgerHarness.reserve(ref.saleId, 'bob')).resolves.toMatchObject({
      saleId: ref.saleId,
    });
  });
});
