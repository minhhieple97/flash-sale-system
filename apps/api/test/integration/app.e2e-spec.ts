import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { ORDER_PERSISTENCE_PRODUCER } from '../../src/infrastructure/queue/queue.constants';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import {
  ACTIVE_FLASH_SALE_ID,
  SALE_WINDOW_DEFAULTS,
} from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { createAppTestingModule } from '../support/app-module.testing';
import { flashSaleStockKey, SALE_LEDGER_REDIS, type SaleLedgerRedis } from '../support/ledger-keys';

describe('AppModule (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await createAppTestingModule().compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    try {
      await app.get(FlashSaleResetService, { strict: false }).reset({});
    } finally {
      await app.close();
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

  it('resets with every default when the request carries no body and no content-type', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/flash-sales/reset');

    expect(response.request.getHeader('content-type')).toBeUndefined();
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
