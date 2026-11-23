import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { configureApp, createFastifyAdapter } from '../../src/app.setup';
import { ORDER_PERSISTENCE_PRODUCER } from '../../src/infrastructure/queue/queue.constants';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import {
  ACTIVE_FLASH_SALE_ID,
  SALE_WINDOW_DEFAULTS,
} from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { startE2eApp } from '../support/e2e-app.harness';
import {
  createIsolatedAppTestingModule,
  DEFAULT_E2E_ENV_OVERRIDES,
  withIsolatedEnv,
} from '../support/isolated-env';
import { flashSaleStockKey, SALE_LEDGER_REDIS, type SaleLedgerRedis } from '../support/ledger-keys';

describe('AppModule (e2e)', () => {
  let app!: NestFastifyApplication;
  let restoreEnv: () => void = () => undefined;

  beforeAll(async () => {
    restoreEnv = withIsolatedEnv(DEFAULT_E2E_ENV_OVERRIDES);
    let started: NestFastifyApplication | undefined;
    try {
      const moduleRef = await (await createIsolatedAppTestingModule()).compile();
      started = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), {
        logger: false,
      });
      configureApp(started);
      await started.init();
      await started.getHttpAdapter().getInstance().ready();
      app = started;
    } catch (error) {
      try {
        await started?.close();
      } finally {
        restoreEnv();
      }
      throw error;
    }
  });

  afterAll(async () => {
    try {
      if (app) await app.get(FlashSaleResetService, { strict: false }).reset({});
    } finally {
      try {
        if (app) await app.close();
      } finally {
        restoreEnv();
      }
    }
  });

  it('reports every dependency up on GET /health', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it.each(['/api/v1/flash-sales/current', '/api/v1/products/featured'])(
    'answers %s with 200 or a coded 404',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);

      expect([200, 404]).toContain(response.status);
      if (response.status === 404) {
        expect(Object.keys(response.body).sort()).toEqual(['code', 'message']);
        expect(typeof response.body.code).toBe('string');
      }
    },
  );

  it('answers the order lookup of an unknown user with status NONE', async () => {
    const response = await request(app.getHttpServer()).get(`/api/v1/orders/user/${randomUUID()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ hasPurchased: false, status: 'NONE', orderId: null });
  });

  it('answers 400 INVALID_USER_ID on a purchase with an invalid user id', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/checkout/purchase')
      .send({ userId: 'a!' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_USER_ID');
  });

  it('resets the sale over HTTP and serves the new state on the next status read', async () => {
    const reset = await request(app.getHttpServer())
      .post('/api/v1/admin/flash-sales/reset')
      .send({ totalStock: 7, startsOffsetSeconds: -60, durationSeconds: 3600 });
    const current = await request(app.getHttpServer()).get('/api/v1/flash-sales/current');

    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ saleState: 'ACTIVE', totalStock: 7, remainingStock: 7 });
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ saleState: 'ACTIVE', totalStock: 7, remainingStock: 7 });
  });

  it('answers 415 when an admin reset request carries no body and no content-type', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/flash-sales/reset');

    expect(response.request.getHeader('content-type')).toBeUndefined();
    expect(response.status).toBe(415);
    expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('resets with every default when an empty JSON object is sent', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/flash-sales/reset')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      saleState: 'ACTIVE',
      totalStock: SALE_WINDOW_DEFAULTS.totalStock,
      remainingStock: SALE_WINDOW_DEFAULTS.totalStock,
    });
  });

  it('answers 400 on an admin reset with an invalid body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/flash-sales/reset')
      .send({ totalStock: -1 });

    expect(response.status).toBe(400);
  });

  it('answers 400 on an admin reset that still sends productName', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/flash-sales/reset')
      .send({ productName: 'Renamed phone' });

    expect(response.status).toBe(400);
  });

  it('answers 503 and returns the unit when queue.add rejects without storing the job', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/flash-sales/reset')
      .send({ totalStock: 7, startsOffsetSeconds: -60 });
    const producer = app.get<Queue>(ORDER_PERSISTENCE_PRODUCER, { strict: false });
    jest.spyOn(producer, 'add').mockRejectedValueOnce(new Error('Connection is closed'));
    const userId = randomUUID();

    const response = await request(app.getHttpServer())
      .post('/api/v1/checkout/purchase')
      .send({ userId });
    const lookup = await request(app.getHttpServer()).get(`/api/v1/orders/user/${userId}`);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('TEMPORARY_FAILURE');
    expect(lookup.body).toMatchObject({ status: 'NONE' });
    await expect(
      app
        .get<SaleLedgerRedis>(SALE_LEDGER_REDIS, { strict: false })
        .get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID)),
    ).resolves.toBe('7');
  });
});

describe('startE2eApp env isolation (e2e)', () => {
  it('isolates pre-set ADMIN_API_KEY, ENABLE_ADMIN_ENDPOINTS, and RATE_LIMIT_ENABLED and restores them on close', async () => {
    const restorePollutedEnv = withIsolatedEnv({
      ADMIN_API_KEY: 'pre-set-secret',
      ENABLE_ADMIN_ENDPOINTS: 'false',
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_MAX: '1',
    });
    let isolatedApp: Awaited<ReturnType<typeof startE2eApp>> | undefined;
    try {
      try {
        isolatedApp = await startE2eApp();

        const reset = await isolatedApp.reset({
          totalStock: 5,
          startsOffsetSeconds: -60,
          durationSeconds: 3600,
        });
        const first = await isolatedApp.purchase({ userId: randomUUID() });
        const second = await isolatedApp.purchase({ userId: randomUUID() });
        await isolatedApp.waitForOrderRows(2);

        expect(reset.status).toBe(200);
        expect(first.status).toBe(202);
        expect(second.status).toBe(202);
      } finally {
        await isolatedApp?.close();
      }

      expect(process.env.ADMIN_API_KEY).toBe('pre-set-secret');
      expect(process.env.ENABLE_ADMIN_ENDPOINTS).toBe('false');
      expect(process.env.RATE_LIMIT_ENABLED).toBe('true');
    } finally {
      restorePollutedEnv();
    }
  });
});
