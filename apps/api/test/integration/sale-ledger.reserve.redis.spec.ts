import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module';
import {
  type ReservationVerdict,
  SaleLedgerModule,
  SaleLedgerRepository,
} from '../../src/modules/sale-ledger';
import { END_MS, START_MS } from '../support/flash-sale.fixtures';
import {
  SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSalePendingKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  ROLLBACK_PURCHASE_REPLY,
  SALE_LEDGER_REDIS,
  type SaleLedgerRedis,
} from '../support/ledger-keys';
import { userIdOf } from '../support/user-id.fixtures';

const PARALLEL_USERS = 100;
const PARALLEL_STOCK = 10;
const SAME_USER_CALLS = 50;
const SAME_USER_STOCK = 20;

describe('SaleLedgerRepository on real Redis', () => {
  let moduleRef: TestingModule;
  let redis: SaleLedgerRedis;
  let ledger: SaleLedgerRepository;
  const saleIds: string[] = [];

  function saleOf(saleId: string) {
    return {
      saleId,
      attempt: (
        user: string,
        nowMs = START_MS,
        orderId = randomUUID(),
      ): Promise<ReservationVerdict> =>
        ledger.reserve({ saleId, userId: userIdOf(user), nowMs, orderId }),
      stock: (): Promise<string | null> => redis.get(flashSaleStockKey(saleId)),
      entry: (user: string): Promise<string | null> =>
        redis.hget(flashSaleUsersKey(saleId), userIdOf(user)),
      usersCount: (): Promise<number> => redis.hlen(flashSaleUsersKey(saleId)),
    };
  }

  async function seedSale(stock: number | null) {
    const saleId = randomUUID();
    saleIds.push(saleId);
    await redis.hset(flashSaleConfigKey(saleId), {
      [F.saleId]: saleId,
      [F.startTimeMs]: String(START_MS),
      [F.endTimeMs]: String(END_MS),
    });
    if (stock !== null) await redis.set(flashSaleStockKey(saleId), String(stock));
    return saleOf(saleId);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, SaleLedgerModule],
    }).compile();
    await moduleRef.init();
    redis = moduleRef.get<SaleLedgerRedis>(SALE_LEDGER_REDIS);
    ledger = moduleRef.get(SaleLedgerRepository);
  });

  afterAll(async () => {
    const keys = saleIds.flatMap((id) => [
      flashSaleConfigKey(id),
      flashSaleStockKey(id),
      flashSaleUsersKey(id),
    ]);
    await redis.del(...keys);
    await moduleRef.close();
  });

  it('returns SALE_NOT_CONFIGURED and writes nothing when the config hash is missing', async () => {
    const saleId = randomUUID();
    saleIds.push(saleId);

    const verdict = await saleOf(saleId).attempt('alice');

    expect(verdict).toBe('SALE_NOT_CONFIGURED');
    expect(await redis.exists(flashSaleStockKey(saleId), flashSaleUsersKey(saleId))).toBe(0);
  });

  it('applies the sale window inclusively at both ends', async () => {
    const sale = await seedSale(10);

    const beforeStart = await sale.attempt('early', START_MS - 1);
    const atStart = await sale.attempt('first', START_MS);
    const atEnd = await sale.attempt('last', END_MS);
    const afterEnd = await sale.attempt('late', END_MS + 1);

    expect([beforeStart, atStart, atEnd, afterEnd]).toEqual([
      'SALE_UPCOMING',
      'RESERVED',
      'RESERVED',
      'SALE_ENDED',
    ]);
    expect(await sale.stock()).toBe('8');
  });

  it('decrements stock by one and stores the reservation entry for the order', async () => {
    const sale = await seedSale(5);
    const orderId = randomUUID();

    const verdict = await sale.attempt('alice', START_MS, orderId);

    expect(verdict).toBe('RESERVED');
    expect(await sale.stock()).toBe('4');
    expect(await sale.entry('alice')).toBe(`RESERVED:${orderId}`);
  });

  it('returns RESERVED again for a resend with the same orderId and decrements stock once', async () => {
    const sale = await seedSale(5);
    const orderId = randomUUID();
    await sale.attempt('alice', START_MS, orderId);

    const resend = await sale.attempt('alice', START_MS, orderId);

    expect(resend).toBe('RESERVED');
    expect(await sale.stock()).toBe('4');
    expect(await sale.entry('alice')).toBe(`RESERVED:${orderId}`);
  });

  it('returns RESERVED for a resend with the same orderId after the window ended', async () => {
    const sale = await seedSale(5);
    const orderId = randomUUID();
    await sale.attempt('alice', END_MS, orderId);

    const lateResend = await sale.attempt('alice', END_MS + 1, orderId);

    expect(lateResend).toBe('RESERVED');
    expect(await sale.stock()).toBe('4');
  });

  it('returns ALREADY_PURCHASED for the same user with a different orderId', async () => {
    const sale = await seedSale(5);
    await sale.attempt('alice');

    const second = await sale.attempt('alice');

    expect(second).toBe('ALREADY_PURCHASED');
    expect(await sale.stock()).toBe('4');
  });

  it('returns SOLD_OUT without adding a users entry when stock is 0', async () => {
    const sale = await seedSale(0);

    const verdict = await sale.attempt('alice');

    expect(verdict).toBe('SOLD_OUT');
    expect(await sale.usersCount()).toBe(0);
  });

  it('returns SALE_NOT_CONFIGURED when the stock key is missing but the config exists', async () => {
    const sale = await seedSale(null);

    const verdict = await sale.attempt('alice');

    expect(verdict).toBe('SALE_NOT_CONFIGURED');
    expect(await sale.stock()).toBeNull();
    expect(await sale.usersCount()).toBe(0);
  });

  it('reports SALE_ENDED before SOLD_OUT when the window is over and stock is 0', async () => {
    const sale = await seedSale(0);

    const verdict = await sale.attempt('alice', END_MS + 1);

    expect(verdict).toBe('SALE_ENDED');
  });

  it('reports ALREADY_PURCHASED before SOLD_OUT when the user holds a unit and stock is 0', async () => {
    const sale = await seedSale(1);
    await sale.attempt('alice');

    const verdict = await sale.attempt('alice');

    expect(await sale.stock()).toBe('0');
    expect(verdict).toBe('ALREADY_PURCHASED');
  });

  it('sells exactly the stock to 100 parallel distinct users', async () => {
    const sale = await seedSale(PARALLEL_STOCK);
    const users = Array.from({ length: PARALLEL_USERS }, (_, index) => `user-${index}`);

    const verdicts = await Promise.all(users.map((user) => sale.attempt(user)));

    expect(verdicts.filter((verdict) => verdict === 'RESERVED')).toHaveLength(PARALLEL_STOCK);
    expect(verdicts.filter((verdict) => verdict === 'SOLD_OUT')).toHaveLength(
      PARALLEL_USERS - PARALLEL_STOCK,
    );
    expect(await sale.stock()).toBe('0');
    expect(await sale.usersCount()).toBe(PARALLEL_STOCK);
  });

  it('lets one user win once out of 50 parallel calls', async () => {
    const sale = await seedSale(SAME_USER_STOCK);

    const verdicts = await Promise.all(
      Array.from({ length: SAME_USER_CALLS }, () => sale.attempt('alice')),
    );

    expect(verdicts.filter((verdict) => verdict === 'RESERVED')).toHaveLength(1);
    expect(verdicts.filter((verdict) => verdict === 'ALREADY_PURCHASED')).toHaveLength(
      SAME_USER_CALLS - 1,
    );
    expect(await sale.stock()).toBe(String(SAME_USER_STOCK - 1));
  });

  describe('rollbackPurchase', () => {
    it('releases the entry without creating a stock key when the stock key is missing', async () => {
      const sale = await seedSale(1);
      const orderId = randomUUID();
      await sale.attempt('alice', START_MS, orderId);
      await redis.del(flashSaleStockKey(sale.saleId));

      const reply = await redis.rollbackPurchase(
        flashSaleStockKey(sale.saleId),
        flashSaleUsersKey(sale.saleId),
        flashSalePendingKey(sale.saleId),
        userIdOf('alice'),
        orderId,
      );

      expect(reply).toBe(ROLLBACK_PURCHASE_REPLY.RELEASED);
      expect(await sale.entry('alice')).toBeNull();
      expect(await redis.exists(flashSaleStockKey(sale.saleId))).toBe(0);
    });
  });
});
