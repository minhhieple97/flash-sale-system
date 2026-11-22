import {
  Controller,
  type ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { ERROR_CODES, RATE_LIMITED_MESSAGE } from '../../src/common/constants/common.constants';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import { ClockService } from '../../src/common/providers/clock.service';
import { RateLimitService } from '../../src/common/services/rate-limit.service';
import type { AppEnv } from '../../src/config/env.interface';

@Controller('limited')
@UseGuards(RateLimitGuard)
class LimitedProbeController {
  @Get('items/:id')
  read(): { ok: boolean } {
    return { ok: true };
  }
}

function mockContext(req: {
  method?: string;
  url?: string;
  routeOptions?: { url?: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}) {
  const headers = new Map<string, string>();
  const reply = {
    header: jest.fn((name: string, value: string): void => {
      headers.set(name, value);
    }),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, ...req }),
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { context, headers, reply };
}

function buildConfig(overrides: Partial<AppEnv> = {}) {
  const env = {
    RATE_LIMIT_ENABLED: true,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 2,
    ...overrides,
  };
  return {
    get: (key: keyof typeof env) => env[key],
  } as unknown as ConfigService<AppEnv, true>;
}

describe('RateLimitGuard', () => {
  it('short-circuits immediately without calling RateLimitService when disabled', () => {
    const consume = jest.fn();
    const guard = new RateLimitGuard(buildConfig({ RATE_LIMIT_ENABLED: false }), {
      consume,
    } as unknown as RateLimitService);
    const { context, headers } = mockContext({ method: 'GET', url: '/probe', ip: '10.0.0.1' });

    expect(guard.canActivate(context)).toBe(true);
    expect(consume).not.toHaveBeenCalled();
    expect(headers.size).toBe(0);
  });

  it('keys by method, route and request.ip while ignoring spoofed x-forwarded-for', () => {
    const config = buildConfig({ RATE_LIMIT_MAX: 2 });
    const guard = new RateLimitGuard(config, new RateLimitService(config, new ClockService()));
    const req = {
      method: 'POST',
      url: '/api/v1/checkout/purchase',
      routeOptions: { url: '/api/v1/checkout/purchase' },
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': ' 203.0.113.5 , 10.0.0.1 ' },
    };

    const first = mockContext(req);
    expect(guard.canActivate(first.context)).toBe(true);
    expect(first.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(first.headers.get('X-RateLimit-Remaining')).toBe('1');

    const second = mockContext({
      ...req,
      headers: { 'x-forwarded-for': ['198.51.100.99'] },
    });
    expect(guard.canActivate(second.context)).toBe(true);
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('0');

    const third = mockContext({
      ...req,
      headers: { 'x-forwarded-for': '192.0.2.77' },
    });
    let caught: unknown;
    try {
      guard.canActivate(third.context);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((caught as HttpException).getResponse()).toEqual({
      code: ERROR_CODES.RATE_LIMITED,
      message: RATE_LIMITED_MESSAGE,
    });
    expect(third.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(third.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  async function startProbeApp(trustProxy: boolean): Promise<NestFastifyApplication> {
    const config = buildConfig({
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_WINDOW_MS: 30_000,
      RATE_LIMIT_MAX: 1,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [LimitedProbeController],
      providers: [
        RateLimitGuard,
        RateLimitService,
        ClockService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy }),
      { logger: false },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  it('ignores spoofed x-forwarded-for across parameterized routes when trustProxy is false', async () => {
    const app = await startProbeApp(false);
    try {
      const ok = await request(app.getHttpServer())
        .get('/api/v1/limited/items/one')
        .set('x-forwarded-for', '198.51.100.7');
      const limited = await request(app.getHttpServer())
        .get('/api/v1/limited/items/two')
        .set('x-forwarded-for', '198.51.100.8');

      expect(ok.status).toBe(200);
      expect(ok.headers['x-ratelimit-limit']).toBe('1');
      expect(ok.headers['x-ratelimit-remaining']).toBe('0');
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.body).toEqual({
        code: ERROR_CODES.RATE_LIMITED,
        message: RATE_LIMITED_MESSAGE,
      });
    } finally {
      await app.close();
    }
  });

  it('uses x-forwarded-for when trustProxy is true so each client IP gets its own bucket', async () => {
    const app = await startProbeApp(true);
    try {
      const firstClient = await request(app.getHttpServer())
        .get('/api/v1/limited/items/one')
        .set('x-forwarded-for', '198.51.100.7');
      const secondClient = await request(app.getHttpServer())
        .get('/api/v1/limited/items/two')
        .set('x-forwarded-for', '198.51.100.8');
      const repeatFirst = await request(app.getHttpServer())
        .get('/api/v1/limited/items/three')
        .set('x-forwarded-for', '198.51.100.7');

      expect(firstClient.status).toBe(200);
      expect(secondClient.status).toBe(200);
      expect(repeatFirst.status).toBe(429);
    } finally {
      await app.close();
    }
  });
});
