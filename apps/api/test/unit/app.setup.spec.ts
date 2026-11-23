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
  REQUEST_ID_HEADER,
  USER_ID_MAX_LENGTH,
} from '../../src/common/constants/common.constants';
import { MetricsModule } from '../../src/modules/metrics/metrics.module';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

  it('generates a UUID X-Request-Id when omitted and echoes it on success and error responses', async () => {
    const ok = await request(app.getHttpServer()).get('/health');
    const missing = await request(app.getHttpServer()).get('/does-not-exist');

    expect(ok.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(missing.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(ok.headers['x-request-id']).not.toBe(missing.headers['x-request-id']);
  });

  it('reuses a safe incoming X-Request-Id header verbatim', async () => {
    const clientRequestId = 'trace-01.abc_DEF:99';

    const response = await request(app.getHttpServer())
      .get('/health')
      .set(REQUEST_ID_HEADER, clientRequestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(clientRequestId);
  });

  it.each([
    ['whitespace', 'bad request id'],
    ['special characters', 'req;injected=1'],
    ['over 64 characters', 'a'.repeat(65)],
    ['empty value', ''],
  ])('replaces malformed X-Request-Id (%s) with a generated UUID', async (_label, badId) => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set(REQUEST_ID_HEADER, badId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(response.headers['x-request-id']).not.toBe(badId);
  });
});

describe('configureApp with MetricsModule', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule],
      controllers: [HealthProbeController, EchoProbeController],
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

  it('records HTTP duration using bounded route templates and skips /metrics self-scrapes', async () => {
    await request(app.getHttpServer()).get('/api/v1/echo/user/alice-sensitive-id');
    await request(app.getHttpServer()).get('/random-404-url-98765');

    const metricsResponse = await request(app.getHttpServer()).get('/metrics');

    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain(
      'flash_sale_http_request_duration_seconds_count{method="GET",route="/api/v1/echo/user/:userId",status_class="2xx"} 1',
    );
    expect(metricsResponse.text).not.toContain('alice-sensitive-id');
    expect(metricsResponse.text).toContain(
      'flash_sale_http_request_duration_seconds_count{method="GET",route="UNMATCHED",status_class="4xx"} 1',
    );
    expect(metricsResponse.text).not.toContain('random-404-url-98765');

    const secondScrape = await request(app.getHttpServer()).get('/metrics');
    expect(secondScrape.text).not.toContain('route="/metrics"');
  });
});
