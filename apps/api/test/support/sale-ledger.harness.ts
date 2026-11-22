import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module';
import {
  type ReservationRef,
  SaleLedgerModule,
  SaleLedgerRepository,
  type SaleLedgerState,
} from '../../src/modules/sale-ledger';
import { buildSnapshot, START_MS } from './flash-sale.fixtures';
import {
  SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  SALE_LEDGER_REDIS,
  type SaleLedgerRedis,
} from './ledger-keys';
import { userIdOf } from './user-id.fixtures';

export interface SaleLedgerHarness {
  redis: SaleLedgerRedis;
  ledger: SaleLedgerRepository;
  newSaleId(): string;
  seedSale(stock: number): Promise<string>;
  reserve(saleId: string, user: string): Promise<ReservationRef>;
  stateOf(saleId: string, overrides?: Partial<SaleLedgerState>): SaleLedgerState;
  close(): Promise<void>;
}

export async function createSaleLedgerHarness(): Promise<SaleLedgerHarness> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppConfigModule, SaleLedgerModule],
  }).compile();
  await moduleRef.init();
  const redis = moduleRef.get<SaleLedgerRedis>(SALE_LEDGER_REDIS);
  const ledger = moduleRef.get(SaleLedgerRepository);
  const saleIds: string[] = [];

  const newSaleId = (): string => {
    const saleId = randomUUID();
    saleIds.push(saleId);
    return saleId;
  };

  return {
    redis,
    ledger,
    newSaleId,
    async seedSale(stock) {
      const saleId = newSaleId();
      await redis.hset(flashSaleConfigKey(saleId), {
        [F.saleId]: saleId,
        [F.startTimeMs]: String(START_MS),
        [F.endTimeMs]: String(START_MS + 1000),
      });
      await redis.set(flashSaleStockKey(saleId), String(stock));
      return saleId;
    },
    async reserve(saleId, user) {
      const ref = { saleId, userId: userIdOf(user), orderId: randomUUID() };
      const verdict = await ledger.reserve({ ...ref, nowMs: START_MS });
      if (verdict !== 'RESERVED') throw new Error(`fixture reservation was ${verdict}`);
      return ref;
    },
    stateOf: (saleId, overrides = {}) => ({
      snapshot: buildSnapshot({ saleId }),
      confirmed: [],
      ...overrides,
    }),
    async close() {
      const keys = saleIds.flatMap((id) => [
        flashSaleConfigKey(id),
        flashSaleStockKey(id),
        flashSaleUsersKey(id),
      ]);
      if (keys.length > 0) await redis.del(...keys);
      await moduleRef.close();
    },
  };
}
