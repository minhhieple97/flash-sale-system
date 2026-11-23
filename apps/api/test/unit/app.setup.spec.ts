import { Body, Controller, Get, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import {
  HEALTH_ROUTE,
  HTTP_BODY_LIMIT_BYTES,
  METRICS_ROUTE,
} from '../../src/common/constants/common.constants';

@Controller(HEALTH_ROUTE)
class HealthProbeController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller(METRICS_ROUTE)
class MetricsProbeController {
  @Get()
  read(): string {
    return '# metrics\n';
  }
}

@Controller('echo')
class EchoProbeController {
  @Post()
  echo(@Body() body: { text: string }): { size: number } {
    return { size: body.text.length };
  }
}

describe('configureApp', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthProbeController, MetricsProbeController, EchoProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: HTTP_BODY_LIMIT_BYTES }),
      { logger: false },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves /health and /metrics outside the global prefix', async () => {
    const health = await request(app.getHttpServer()).get('/health');
    const metrics = await request(app.getHttpServer()).get('/metrics');
    const prefixedMetrics = await request(app.getHttpServer()).get('/api/v1/metrics');

    expect(health.status).toBe(200);
    expect(metrics.status).toBe(200);
    expect(prefixedMetrics.status).toBe(404);
  });

  it('attaches security headers once to success, JSON POST, and error responses', async () => {
    const ok = await request(app.getHttpServer()).get('/metrics');
    const echoed = await request(app.getHttpServer()).post('/api/v1/echo').send({ text: 'ok' });
    const missing = await request(app.getHttpServer()).get('/does-not-exist');

    for (const response of [ok, echoed, missing]) {
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('enforces HTTP_BODY_LIMIT_BYTES when FastifyAdapter uses the configured limit', async () => {
    const oversized = 'a'.repeat(HTTP_BODY_LIMIT_BYTES + 128);

    const response = await request(app.getHttpServer())
      .post('/api/v1/echo')
      .send({ text: oversized });

    expect(response.status).toBe(413);
  });
});
