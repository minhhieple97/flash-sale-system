import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Test, type TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppConfigModule } from '../../src/config/app-config.module';
import {
  REDIS_CLIENT,
  REDIS_COMMAND_TIMEOUT_MS,
} from '../../src/infrastructure/redis/redis.constants';
import { RedisModule } from '../../src/infrastructure/redis/redis.module';
import { SaleLedgerModule } from '../../src/modules/sale-ledger';
import { END_MS, START_MS } from '../support/flash-sale.fixtures';
import {
  SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSalePendingKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  SALE_LEDGER_REDIS,
  SALE_LEDGER_SCRIPTS,
  type SaleLedgerRedis,
} from '../support/ledger-keys';
import { userIdOf } from '../support/user-id.fixtures';

const CONCURRENT_CALLS = 200;
const CALLS_PER_LOOP_TURN = 20;
const REQUEST_CPU_US = 250;
const SALE_STOCK = 50;
const MAX_READS_PER_COMMAND = 0.5;
const READS_COUNTER = /^total_reads_processed:(\d+)/m;
const PAUSE_MS = 5_000;
const TIMEOUT_SLACK_MS = 300;
const PAUSE_TEST_TIMEOUT_MS = PAUSE_MS * 2;

async function totalReadsProcessed(observer: Redis): Promise<number> {
  const match = READS_COUNTER.exec(await observer.info('stats'));
  return Number(match?.[1]);
}

const seededSaleIds: string[] = [];

async function seedSale(redis: Redis): Promise<string> {
  const saleId = randomUUID();
  seededSaleIds.push(saleId);
  await redis.hset(flashSaleConfigKey(saleId), {
    [F.saleId]: saleId,
    [F.startTimeMs]: String(START_MS),
    [F.endTimeMs]: String(END_MS),
  });
  await redis.set(flashSaleStockKey(saleId), String(SALE_STOCK));
  return saleId;
}

function spinMicroseconds(us: number): void {
  const end = process.hrtime.bigint() + BigInt(us * 1_000);
  while (process.hrtime.bigint() < end);
}

/**
 * Issues the calls the way the API does under load: several requests per event-loop turn, each
 * after a few hundred microseconds of handler CPU. Firing all calls in one tick would let the
 * kernel coalesce the writes even without pipelining.
 */
function attemptLikeLoadedApi(
  attempt: (index: number) => Promise<unknown>,
  indexes: number[],
): Promise<unknown[]> {
  const turns: Promise<unknown[]>[] = [];
  for (let first = 0; first < indexes.length; first += CALLS_PER_LOOP_TURN) {
    const batch = indexes.slice(first, first + CALLS_PER_LOOP_TURN);
    turns.push(
      new Promise((resolve) => {
        setImmediate(() => {
          const replies = batch.map((index) => {
            spinMicroseconds(REQUEST_CPU_US);
            return attempt(index);
          });
          resolve(Promise.all(replies));
        });
      }),
    );
  }
  return Promise.all(turns).then((turnReplies) => turnReplies.flat());
}

function attemptFor(redis: SaleLedgerRedis, saleId: string) {
  return (index: number): Promise<unknown> =>
    redis.attemptPurchase(
      flashSaleConfigKey(saleId),
      flashSaleStockKey(saleId),
      flashSaleUsersKey(saleId),
      flashSalePendingKey(saleId),
      userIdOf(`buyer-${index}`),
      START_MS,
      `order-${index}`,
    );
}

async function startRedisModule(): Promise<TestingModule> {
  const started = await Test.createTestingModule({
    imports: [AppConfigModule, RedisModule],
  }).compile();
  await started.init();
  return started;
}

async function settle(
  command: Promise<unknown>,
): Promise<{ elapsedMs: number; isRejected: boolean }> {
  const started = performance.now();
  const isRejected = await command.then(
    () => false,
    () => true,
  );
  return { elapsedMs: performance.now() - started, isRejected };
}

describe('RedisModule', () => {
  let moduleRef: TestingModule;
  let client: Redis;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, RedisModule, SaleLedgerModule],
    }).compile();
    await moduleRef.init();
    client = moduleRef.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    const keys = seededSaleIds.flatMap((saleId) => [
      flashSaleConfigKey(saleId),
      flashSaleStockKey(saleId),
      flashSaleUsersKey(saleId),
      flashSalePendingKey(saleId),
    ]);
    if (keys.length > 0) await client.del(...keys);
    await moduleRef.close();
  });

  it('provides a client that answers PING with PONG', async () => {
    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('connects to the configured REDIS_PORT', () => {
    expect(client.options.port).toBe(Number(process.env.REDIS_PORT));
  });

  it.each(SALE_LEDGER_SCRIPTS.map((script) => script.name))(
    'carries the %s ledger script on the shared client once SaleLedgerModule is loaded',
    (name) => {
      expect(typeof Reflect.get(moduleRef.get(SALE_LEDGER_REDIS), name)).toBe('function');
      expect(moduleRef.get(SALE_LEDGER_REDIS)).toBe(client);
    },
  );

  it('batches concurrent script calls into few socket reads with the same replies as sequential calls', async () => {
    const redis = moduleRef.get<SaleLedgerRedis>(SALE_LEDGER_REDIS);
    const observer = new Redis({ host: client.options.host, port: client.options.port });
    const indexes = Array.from({ length: CONCURRENT_CALLS }, (_, index) => index);
    const sequentialAttempt = attemptFor(redis, await seedSale(redis));
    const sequentialReplies: unknown[] = [];
    for (const index of indexes) sequentialReplies.push(await sequentialAttempt(index));
    const concurrentAttempt = attemptFor(redis, await seedSale(redis));
    const readsBefore = await totalReadsProcessed(observer);

    const concurrentReplies = await attemptLikeLoadedApi(concurrentAttempt, indexes);

    const readsPerCommand =
      ((await totalReadsProcessed(observer)) - readsBefore) / CONCURRENT_CALLS;
    await observer.quit();
    expect(concurrentReplies).toEqual(sequentialReplies);
    expect(readsPerCommand).toBeLessThan(MAX_READS_PER_COMMAND);
  });

  it('quits the client when the module closes', async () => {
    const closing = await startRedisModule();
    const closingClient = closing.get<Redis>(REDIS_CLIENT);

    await closing.close();

    expect(closingClient.status).toBe('end');
  });

  it('answers PING right after module init', async () => {
    const fresh = await startRedisModule();

    const reply = fresh.get<Redis>(REDIS_CLIENT).ping();

    await expect(reply).resolves.toBe('PONG');
    await fresh.close();
  });

  it('does not throw on shutdown while the client is reconnecting', async () => {
    const reconnecting = await startRedisModule();
    const reconnectingClient = reconnecting.get<Redis>(REDIS_CLIENT);
    const reconnectScheduled = once(reconnectingClient, 'reconnecting');
    reconnectingClient.disconnect(true);
    await reconnectScheduled;

    const closed = reconnecting.close();

    await expect(closed).resolves.toBeUndefined();
  });

  it(
    'rejects a hot-path command within commandTimeout plus 300 ms while Redis is paused',
    async () => {
      const admin = new Redis({ host: client.options.host, port: client.options.port });
      await admin.client('PAUSE', PAUSE_MS, 'ALL');
      try {
        const { elapsedMs, isRejected } = await settle(client.get(flashSaleStockKey(randomUUID())));

        expect(elapsedMs).toBeLessThan(REDIS_COMMAND_TIMEOUT_MS + TIMEOUT_SLACK_MS);
        expect(isRejected).toBe(true);
      } finally {
        await admin.client('UNPAUSE');
        await admin.quit();
      }
    },
    PAUSE_TEST_TIMEOUT_MS,
  );
});
