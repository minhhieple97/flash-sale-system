import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { HealthController } from '../../src/modules/health/controllers/health.controller';
import type { HealthReport } from '../../src/modules/health/interfaces/health.interface';
import { HealthService } from '../../src/modules/health/services/health.service';

const OK_REPORT: HealthReport = { status: 'ok', checks: { database: 'up', redis: 'up' } };
const ERROR_REPORT: HealthReport = { status: 'error', checks: { database: 'down', redis: 'up' } };

describe('HealthController', () => {
  let app: NestFastifyApplication;
  const check = jest.fn<Promise<HealthReport>, []>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { check } }],
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

  it('answers 200 with the report when healthy', async () => {
    check.mockResolvedValue(OK_REPORT);

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(OK_REPORT);
  });

  it('answers 503 with the same report shape when unhealthy', async () => {
    check.mockResolvedValue(ERROR_REPORT);

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual(ERROR_REPORT);
  });

  it('does not serve health under the api prefix', async () => {
    check.mockResolvedValue(OK_REPORT);

    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(404);
  });
});
