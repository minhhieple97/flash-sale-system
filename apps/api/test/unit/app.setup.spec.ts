import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, createFastifyAdapter } from '../../src/app.setup';
import {
  HEALTH_ROUTE,
  HTTP_BODY_LIMIT_BYTES,
  HTTP_MAX_PARAM_LENGTH,
  METRICS_ROUTE,
  USER_ID_MAX_LENGTH,
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

  @Get('user/:userId')
  user(@Param('userId') userId: string): { userId: string } {
    return { userId };
  }
}

describe('configureApp', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthProbeController, MetricsProbeController, EchoProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), {
      logger: false,
    });
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

  it('enforces HTTP_BODY_LIMIT_BYTES with a 413 PAYLOAD_TOO_LARGE envelope', async () => {
    const oversized = 'a'.repeat(HTTP_BODY_LIMIT_BYTES + 128);

    const response = await request(app.getHttpServer())
      .post('/api/v1/echo')
      .send({ text: oversized });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    });
  });

  it.each([
    ['a 128-character email with encoded + and @', `${'alice+tag.'.repeat(11)}abcdef@example.com`],
    ['a worst-case 128-character percent-encoded userId', '@'.repeat(USER_ID_MAX_LENGTH)],
  ])('accepts %s on a :userId route without 414', async (_label, userId) => {
    expect(userId).toHaveLength(USER_ID_MAX_LENGTH);

    const response = await request(app.getHttpServer()).get(
      `/api/v1/echo/user/${encodeURIComponent(userId)}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });

  it('rejects route params exceeding HTTP_MAX_PARAM_LENGTH with 414', async () => {
    const tooLong = 'a'.repeat(HTTP_MAX_PARAM_LENGTH + 1);

    const response = await request(app.getHttpServer()).get(`/api/v1/echo/user/${tooLong}`);

    expect(response.status).toBe(414);
  });
});
