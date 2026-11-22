import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module';
import { SaleLedgerModule } from '../../src/modules/sale-ledger';
import { END_MS, START_MS } from '../support/flash-sale.fixtures';
import {
  ADOPT_ORDER_REPLY,
  CONFIRM_PURCHASE_REPLY,
  SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSaleMaintenanceLockKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  RELEASE_LOCK_REPLY,
  RESTORE_CONFIRMED_BATCH_REPLY,
  RESTORE_SALE_REPLY,
  ROLLBACK_PURCHASE_REPLY,
  SALE_LEDGER_REDIS,
  SALE_LEDGER_SCRIPTS,
  type SaleLedgerRedis,
  type SaleLedgerScriptName,
} from '../support/ledger-keys';

const USER_ID = 'alice@example.com';
const ORDER_ID = randomUUID();
const STORED_ORDER_ID = randomUUID();
const CONFIRMED_USER_ID = 'bob@example.com';

interface IdempotencyCase {
  seed(redis: SaleLedgerRedis, saleId: string): Promise<void>;
  run(redis: SaleLedgerRedis, saleId: string): Promise<unknown>;
  replies: readonly [first: unknown, resend: unknown];
}

interface SaleState {
  config: Record<string, string>;
  stock: string | null;
  users: Record<string, string>;
  lock: string | null;
}

async function seedOpenSale(redis: SaleLedgerRedis, saleId: string, stock: number): Promise<void> {
  await redis.hset(flashSaleConfigKey(saleId), {
    [F.saleId]: saleId,
    [F.startTimeMs]: String(START_MS),
    [F.endTimeMs]: String(END_MS),
  });
  await redis.set(flashSaleStockKey(saleId), String(stock));
}

const CASES = {
  attemptPurchase: {
    seed: (redis, saleId) => seedOpenSale(redis, saleId, 5),
    run: (redis, saleId) =>
      redis.attemptPurchase(
        flashSaleConfigKey(saleId),
        flashSaleStockKey(saleId),
        flashSaleUsersKey(saleId),
        USER_ID,
        START_MS,
        ORDER_ID,
      ),
    replies: ['RESERVED', 'RESERVED'],
  },
  rollbackPurchase: {
    seed: async (redis, saleId) => {
      await seedOpenSale(redis, saleId, 4);
      await redis.hset(flashSaleUsersKey(saleId), USER_ID, `RESERVED:${ORDER_ID}`);
    },
    run: (redis, saleId) =>
      redis.rollbackPurchase(
        flashSaleStockKey(saleId),
        flashSaleUsersKey(saleId),
        USER_ID,
        ORDER_ID,
      ),
    replies: [ROLLBACK_PURCHASE_REPLY.RELEASED, ROLLBACK_PURCHASE_REPLY.NOT_RESERVED],
  },
  confirmPurchase: {
    seed: async (redis, saleId) => {
      await seedOpenSale(redis, saleId, 4);
      await redis.hset(flashSaleUsersKey(saleId), USER_ID, `RESERVED:${ORDER_ID}`);
    },
    run: (redis, saleId) =>
      redis.confirmPurchase(flashSaleUsersKey(saleId), USER_ID, ORDER_ID, STORED_ORDER_ID),
    replies: [CONFIRM_PURCHASE_REPLY.CONFIRMED, CONFIRM_PURCHASE_REPLY.CONFIRMED],
  },
  adoptOrder: {
    seed: (redis, saleId) => seedOpenSale(redis, saleId, 4),
    run: (redis, saleId) =>
      redis.adoptOrder(
        flashSaleStockKey(saleId),
        flashSaleUsersKey(saleId),
        USER_ID,
        STORED_ORDER_ID,
      ),
    replies: [ADOPT_ORDER_REPLY.ADOPTED, ADOPT_ORDER_REPLY.ADOPTED],
  },
  restoreSale: {
    seed: async (redis, saleId) => {
      await redis.hset(flashSaleUsersKey(saleId), USER_ID, `RESERVED:${ORDER_ID}`);
    },
    run: (redis, saleId) =>
      redis.restoreSale(
        flashSaleConfigKey(saleId),
        flashSaleStockKey(saleId),
        flashSaleUsersKey(saleId),
        5,
        3,
        F.saleId,
        saleId,
        F.startTimeMs,
        String(START_MS),
        F.endTimeMs,
        String(END_MS),
        CONFIRMED_USER_ID,
        `CONFIRMED:${STORED_ORDER_ID}`,
      ),
    replies: [RESTORE_SALE_REPLY.HYDRATED, RESTORE_SALE_REPLY.ALREADY_PRESENT],
  },
  releaseLock: {
    seed: async (redis, saleId) => {
      await redis.set(flashSaleMaintenanceLockKey(saleId), ORDER_ID);
    },
    run: (redis, saleId) => redis.releaseLock(flashSaleMaintenanceLockKey(saleId), ORDER_ID),
    replies: [RELEASE_LOCK_REPLY.RELEASED, RELEASE_LOCK_REPLY.NOT_OWNER],
  },
  restoreConfirmedBatch: {
    seed: async (redis, saleId) => {
      await redis.hset(flashSaleUsersKey(saleId), USER_ID, `RESERVED:${ORDER_ID}`);
    },
    run: (redis, saleId) =>
      redis.restoreConfirmedBatch(
        flashSaleUsersKey(saleId),
        CONFIRMED_USER_ID,
        `CONFIRMED:${STORED_ORDER_ID}`,
      ),
    replies: [RESTORE_CONFIRMED_BATCH_REPLY.WROTE, RESTORE_CONFIRMED_BATCH_REPLY.NOOP],
  },
} satisfies Record<SaleLedgerScriptName, IdempotencyCase>;

describe('every registered sale-ledger script under a client resend', () => {
  let moduleRef: TestingModule;
  let redis: SaleLedgerRedis;
  const saleIds: string[] = [];

  async function readState(saleId: string): Promise<SaleState> {
    return {
      config: await redis.hgetall(flashSaleConfigKey(saleId)),
      stock: await redis.get(flashSaleStockKey(saleId)),
      users: await redis.hgetall(flashSaleUsersKey(saleId)),
      lock: await redis.get(flashSaleMaintenanceLockKey(saleId)),
    };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, SaleLedgerModule],
    }).compile();
    await moduleRef.init();
    redis = moduleRef.get<SaleLedgerRedis>(SALE_LEDGER_REDIS);
  });

  afterAll(async () => {
    const keys = saleIds.flatMap((id) => [
      flashSaleConfigKey(id),
      flashSaleStockKey(id),
      flashSaleUsersKey(id),
      flashSaleMaintenanceLockKey(id),
    ]);
    if (keys.length > 0) await redis.del(...keys);
    await moduleRef.close();
  });

  it('has an idempotency case for every registered script', () => {
    const registered = SALE_LEDGER_SCRIPTS.map((script) => script.name).sort();

    expect(registered).toEqual(Object.keys(CASES).sort());
  });

  it.each(Object.entries(CASES))(
    'leaves the same state and the declared replies after a resend of %s',
    async (_, testCase: IdempotencyCase) => {
      const saleId = randomUUID();
      saleIds.push(saleId);
      await testCase.seed(redis, saleId);

      const firstReply = await testCase.run(redis, saleId);
      const afterFirst = await readState(saleId);
      const resendReply = await testCase.run(redis, saleId);
      const afterResend = await readState(saleId);

      expect(afterResend).toEqual(afterFirst);
      expect([firstReply, resendReply]).toEqual(testCase.replies);
    },
  );
});
