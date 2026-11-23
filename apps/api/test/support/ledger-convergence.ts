import type { TestingModule } from '@nestjs/testing';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { OrphanSweeper } from '../../src/modules/orders/services/orphan-sweeper.service';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { SaleLedgerRepository } from '../../src/modules/sale-ledger';
import {
  flashSaleStockKey,
  flashSaleUsersKey,
  SALE_LEDGER_REDIS,
  type SaleLedgerRedis,
} from './ledger-keys';

export interface LedgerUnderTest {
  saleId: string;
  totalStock: number;
}

export async function expectLedgerConverged(
  app: TestingModule,
  { saleId, totalStock }: LedgerUnderTest,
): Promise<void> {
  const sweeper = app.get(OrphanSweeper, { strict: false });
  const redis = app.get<SaleLedgerRedis>(SALE_LEDGER_REDIS, { strict: false });
  await sweeper.sweepOrphans(saleId, 0);

  const jobless = await findJoblessReservations(app, saleId);
  const stock = Number(await redis.get(flashSaleStockKey(saleId)));
  const held = await redis.hlen(flashSaleUsersKey(saleId));
  expect({ jobless, units: stock + held }).toEqual({ jobless: [], units: totalStock });
}

async function findJoblessReservations(
  app: TestingModule,
  saleId: string,
): Promise<ReservationRef[]> {
  const cache = app.get(SaleLedgerRepository, { strict: false });
  const persistence = app.get(OrderPersistenceService, { strict: false });
  const jobless: ReservationRef[] = [];
  for (const ref of await cache.listPendingReservations(saleId)) {
    if (await persistence.hasPendingJob(ref)) continue;
    const slot = await cache.findSlot(saleId, ref.userId);
    if (slot.status === 'RESERVED' && slot.orderId === ref.orderId) jobless.push(ref);
  }
  return jobless;
}
