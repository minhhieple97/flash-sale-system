import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import { DEFAULT_CAMPAIGN_TOTAL_STOCK } from '../../src/modules/flash-sales/constants/flash-sales.constants';

describe('AppModule (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
      totalStock: DEFAULT_CAMPAIGN_TOTAL_STOCK,
      remainingStock: DEFAULT_CAMPAIGN_TOTAL_STOCK,
    });
  });

  it('answers 400 on an admin reset with an invalid body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/flash-sales/reset')
      .send({ totalStock: -1 });

    expect(response.status).toBe(400);
  });
});
