import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { MetricsModule } from '../../src/modules/metrics/metrics.module';
import { MetricsService } from '../../src/modules/metrics/services/metrics.service';

describe('MetricsController', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Prometheus text format at GET /metrics outside the API prefix', async () => {
    const metrics = app.get(MetricsService);
    metrics.recordPurchaseAttempt('RESERVED');

    const response = await request(app.getHttpServer()).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(response.text).toContain('flash_sale_purchase_attempts_total{outcome="RESERVED"} 1');
  });

  it('is not exposed under /api/v1/metrics', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/metrics');

    expect(response.status).toBe(404);
  });
});
