import { randomUUID } from 'node:crypto';
import type { DynamicModule, Type } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AppModule as AppModuleType } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ERROR_CODES } from '../../src/common/constants/common.constants';
import {
  LEDGER_MAINTENANCE_INTERVAL,
  MAINTENANCE_DISABLED,
  UNSUPPORTED_MEDIA_TYPE_CODE,
} from '../../src/modules/admin/constants/admin.constants';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import {
  ORDER_QUEUE_JOBS_METRIC,
  PURCHASE_ATTEMPTS_METRIC,
} from '../../src/modules/metrics/constants/metrics.constants';

const ADMIN_KEY = 'secret-key';
const RESET_PATH = '/api/v1/admin/flash-sales/reset';
const PURCHASE_PATH = '/api/v1/checkout/purchase';

function withIsolatedEnv(overrides: Readonly<Record<string, string>>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function createHttpApp(root: Type<unknown> | DynamicModule): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [root] })
    .overrideProvider(LEDGER_MAINTENANCE_INTERVAL)
    .useValue(MAINTENANCE_DISABLED)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('operational and security HTTP controls (e2e)', () => {
  let app: NestFastifyApplication;
  let AppModule: typeof AppModuleType;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = withIsolatedEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
      ENABLE_ADMIN_ENDPOINTS: 'true',
      ADMIN_API_KEY: ADMIN_KEY,
      SALE_STARTS_AT: '',
      SALE_ENDS_AT: '',
      SALE_TOTAL_STOCK: '',
    });
    ({ AppModule } = await import('../../src/app.module'));
    app = await createHttpApp(AppModule);
  });

  afterAll(async () => {
    try {
      await app.get(FlashSaleResetService, { strict: false }).reset({});
    } finally {
      await app.close();
      restoreEnv();
    }
  });

  it('enforces admin x-admin-key auth (401), JSON content-type (415), and allows valid JSON reset (200)', async () => {
    const server = app.getHttpServer();

    const missingKey = await request(server).post(RESET_PATH).send({});
    const wrongKey = await request(server).post(RESET_PATH).set('x-admin-key', 'wrong').send({});
    const noContentType = await request(server).post(RESET_PATH).set('x-admin-key', ADMIN_KEY);
    const validReset = await request(server)
      .post(RESET_PATH)
      .set('x-admin-key', ADMIN_KEY)
      .send({});

    expect(missingKey.status).toBe(401);
    expect(missingKey.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(wrongKey.status).toBe(401);
    expect(wrongKey.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(noContentType.status).toBe(415);
    expect(noContentType.body.code).toBe(UNSUPPORTED_MEDIA_TYPE_CODE);
    expect(validReset.status).toBe(200);
    expect(validReset.body.saleState).toBe('ACTIVE');
  });

  it('rate-limits the 3rd checkout purchase with 429 RATE_LIMITED and Retry-After', async () => {
    const server = app.getHttpServer();

    const first = await request(server).post(PURCHASE_PATH).send({ userId: randomUUID() });
    const second = await request(server).post(PURCHASE_PATH).send({ userId: randomUUID() });
    const third = await request(server).post(PURCHASE_PATH).send({ userId: randomUUID() });

    expect(first.status).toBe(202);
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    expect(second.status).toBe(202);
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    expect(third.status).toBe(429);
    expect(third.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(Number(third.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('serves Prometheus text metrics on GET /metrics', async () => {
    const response = await request(app.getHttpServer()).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain(PURCHASE_ATTEMPTS_METRIC);
    expect(response.text).toContain(ORDER_QUEUE_JOBS_METRIC);
  });
});
