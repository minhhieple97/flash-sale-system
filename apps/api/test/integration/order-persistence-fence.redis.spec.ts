import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { ClockService } from '../../src/common/providers/clock.service';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { flashSaleStockKey } from '../support/ledger-keys';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';

const STOCK = 2;

/** A queue whose connection dropped: every command rejects, so a stored job cannot be ruled out. */
function unreachableQueue(): Queue<ReservationRef> {
  const lost = async (): Promise<never> => {
    throw new Error('queue connection lost');
  };
  return { add: lost, getJob: lost } as unknown as Queue<ReservationRef>;
}

/** Persistence jobs whose reservation no longer exists in Redis, against real PostgreSQL and Redis. */
describe('order persistence liveness fence', () => {
  let ledgerHarness: SaleLedgerHarness;
  let db: SaleDbHarness;
  let moduleRef: TestingModule;
  let service: OrderPersistenceService;

  beforeAll(async () => {
    ledgerHarness = await createSaleLedgerHarness();
    db = await createSaleDbHarness();
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [OrdersRepository],
    }).compile();
    await moduleRef.init();
    service = new OrderPersistenceService(
      unreachableQueue(),
      moduleRef.get(OrdersRepository),
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

  async function reserveOnNewSale(): Promise<ReservationRef> {
    const saleId = await ledgerHarness.seedSale(STOCK);
    await db.seedSale(saleId, STOCK);
    return ledgerHarness.reserve(saleId, 'alice');
  }

  const redisStockOf = async (saleId: string): Promise<number> =>
    Number(await ledgerHarness.redis.get(flashSaleStockKey(saleId)));

  it('reports STALE and writes nothing when the reservation was released before the job ran', async () => {
    const ref = await reserveOnNewSale();
    await ledgerHarness.ledger.releaseReservation(ref);

    const result = await service.persistReservedOrder(ref);

    expect(result).toEqual({ outcome: 'STALE', orderId: ref.orderId });
    expect(await db.ordersOf(ref.saleId)).toEqual([]);
    expect(await db.stockOf(ref.saleId)).toBe(STOCK);
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({ status: 'NONE' });
  });

  it('reports STALE and leaves the live reservation alone when the slot holds another orderId', async () => {
    const live = await reserveOnNewSale();
    const stale: ReservationRef = { ...live, orderId: randomUUID() };

    const result = await service.persistReservedOrder(stale);

    expect(result).toEqual({ outcome: 'STALE', orderId: stale.orderId });
    expect(await db.ordersOf(live.saleId)).toEqual([]);
    expect(await db.stockOf(live.saleId)).toBe(STOCK);
    expect(await ledgerHarness.ledger.findSlot(live.saleId, live.userId)).toEqual({
      status: 'RESERVED',
      orderId: live.orderId,
    });
  });

  it('releases the reservation when neither the enqueue nor the stored-job check can be confirmed', async () => {
    const ref = await reserveOnNewSale();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const outcome = await service.scheduleReservation(ref);

    expect(outcome).toBe('RELEASED');
    expect(await redisStockOf(ref.saleId)).toBe(STOCK);
    expect(await ledgerHarness.ledger.findSlot(ref.saleId, ref.userId)).toEqual({ status: 'NONE' });
    await expect(ledgerHarness.reserve(ref.saleId, 'alice')).resolves.toMatchObject({
      userId: ref.userId,
    });
  });

  it('turns a job that was stored despite the failed enqueue into a no-op', async () => {
    const ref = await reserveOnNewSale();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await service.scheduleReservation(ref).catch(() => undefined);

    const result = await service.persistReservedOrder(ref);

    expect(result).toEqual({ outcome: 'STALE', orderId: ref.orderId });
    expect(await db.ordersOf(ref.saleId)).toEqual([]);
    expect(await redisStockOf(ref.saleId)).toBe(await db.stockOf(ref.saleId));
  });
});
