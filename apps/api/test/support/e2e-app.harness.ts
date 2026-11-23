import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { configureApp, createFastifyAdapter } from '../../src/app.setup';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import {
  createIsolatedAppTestingModule,
  DEFAULT_E2E_ENV_OVERRIDES,
  withIsolatedEnv,
} from './isolated-env';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  SALE_LEDGER_REDIS,
  type SaleLedgerRedis,
} from './ledger-keys';
import type { OrderRow } from './order-row.interface';
import { waitFor } from './wait-for';

const LOOPBACK_HOST = '127.0.0.1';
const EPHEMERAL_PORT = 0;
const API_PREFIX = '/api/v1';
const WORKER_TIMEOUT_MS = 10000;

export interface HttpReply {
  status: number;
  body: Record<string, unknown>;
}

export interface ResetBody {
  totalStock?: number;
  startsOffsetSeconds?: number;
  durationSeconds?: number;
}

export interface E2eApp {
  reset(body?: ResetBody): Promise<HttpReply>;
  purchase(body: unknown): Promise<HttpReply>;
  lookup(userId: string): Promise<HttpReply>;
  orderRows(): Promise<OrderRow[]>;
  remainingStockInDb(): Promise<number>;
  stockInRedis(): Promise<string | null>;
  deleteConfigKey(): Promise<void>;
  waitForOrderRows(count: number): Promise<OrderRow[]>;
  waitForConfirmed(userId: string): Promise<HttpReply>;
  close(): Promise<void>;
}

interface Closeable {
  close(): Promise<void>;
}

async function send(url: string, init?: RequestInit): Promise<HttpReply> {
  const response = await fetch(url, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function postJson(url: string, body: unknown): Promise<HttpReply> {
  return send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function closeAndRestore(
  closeable: Closeable | undefined,
  restoreEnv: () => void,
): Promise<void> {
  try {
    await closeable?.close();
  } finally {
    restoreEnv();
  }
}

function buildE2eApp(app: NestFastifyApplication, baseUrl: string, restoreEnv: () => void): E2eApp {
  const redis = app.get<SaleLedgerRedis>(SALE_LEDGER_REDIS, { strict: false });
  const dataSource = app.get(DataSource, { strict: false });
  const reset = (body: ResetBody = {}): Promise<HttpReply> =>
    postJson(`${baseUrl}/admin/flash-sales/reset`, body);
  const lookup = (userId: string): Promise<HttpReply> =>
    send(`${baseUrl}/orders/user/${encodeURIComponent(userId)}`);
  const orderRows = (): Promise<OrderRow[]> =>
    dataSource.query('SELECT id, user_id, status FROM orders WHERE flash_sale_id = $1', [
      ACTIVE_FLASH_SALE_ID,
    ]);

  return {
    reset,
    lookup,
    orderRows,
    purchase: (body) => postJson(`${baseUrl}/checkout/purchase`, body),
    async remainingStockInDb() {
      const rows: { remaining_stock: number }[] = await dataSource.query(
        'SELECT remaining_stock FROM flash_sales WHERE id = $1',
        [ACTIVE_FLASH_SALE_ID],
      );
      return rows[0].remaining_stock;
    },
    stockInRedis: () => redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID)),
    async deleteConfigKey() {
      await redis.del(flashSaleConfigKey(ACTIVE_FLASH_SALE_ID));
    },
    waitForOrderRows: (count) =>
      waitFor(orderRows, (rows) => rows.length === count, { timeoutMs: WORKER_TIMEOUT_MS }),
    waitForConfirmed: (userId) =>
      waitFor(
        () => lookup(userId),
        (reply) => reply.body.status === 'CONFIRMED',
        { timeoutMs: WORKER_TIMEOUT_MS },
      ),
    async close() {
      try {
        await reset({});
      } finally {
        await closeAndRestore(app, restoreEnv);
      }
    },
  };
}

/** The full AppModule listening on an ephemeral loopback port, driven over real HTTP. */
export async function startE2eApp(
  envOverrides: Readonly<Record<string, string>> = {},
): Promise<E2eApp> {
  const restoreEnv = withIsolatedEnv({ ...DEFAULT_E2E_ENV_OVERRIDES, ...envOverrides });
  let closeable: Closeable | undefined;
  try {
    const moduleRef = await (await createIsolatedAppTestingModule()).compile();
    closeable = moduleRef;
    const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), {
      logger: false,
    });
    closeable = app;
    configureApp(app);
    await app.listen(EPHEMERAL_PORT, LOOPBACK_HOST);
    const baseUrl = `${await app.getUrl()}${API_PREFIX}`;
    return buildE2eApp(app, baseUrl, restoreEnv);
  } catch (error) {
    await closeAndRestore(closeable, restoreEnv);
    throw error;
  }
}
