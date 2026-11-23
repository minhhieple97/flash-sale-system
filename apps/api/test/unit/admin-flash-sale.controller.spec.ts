import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import {
  ERROR_CODES,
  UNAUTHORIZED_ADMIN_MESSAGE,
} from '../../src/common/constants/common.constants';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import { ClockService } from '../../src/common/providers/clock.service';
import { RateLimitService } from '../../src/common/services/rate-limit.service';
import type { AppEnv } from '../../src/config/env.interface';
import { AdminFlashSaleController } from '../../src/modules/admin/controllers/admin-flash-sale.controller';
import { AdminEndpointsGuard } from '../../src/modules/admin/guards/admin-endpoints.guard';
import type { ResetFlashSaleInput } from '../../src/modules/admin/interfaces/admin.interface';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import type { FlashSaleStatus } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import { buildSnapshot } from '../support/flash-sale.fixtures';

const RESET_PATH = '/api/v1/admin/flash-sales/reset';
const STATUS: FlashSaleStatus = {
  ...buildSnapshot(),
  saleState: 'ACTIVE',
  serverTimeMs: 1_800_000_100_000,
};
const RESPONSE_KEYS = [
  'endsAt',
  'remainingStock',
  'saleId',
  'saleState',
  'serverTime',
  'startsAt',
  'totalStock',
];

describe('AdminFlashSaleController', () => {
  let app: NestFastifyApplication;
  let isAdminEnabled = true;
  let adminApiKey: string | undefined;
  let rateLimitEnabled = false;
  let rateLimitMax = 1;
  const reset = jest.fn<Promise<FlashSaleStatus>, [ResetFlashSaleInput]>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminFlashSaleController],
      providers: [
        AdminEndpointsGuard,
        RateLimitGuard,
        RateLimitService,
        ClockService,
        { provide: FlashSaleResetService, useValue: { reset } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: keyof AppEnv) => {
              const overrides: Partial<AppEnv> = {
                NODE_ENV: 'test',
                ENABLE_ADMIN_ENDPOINTS: isAdminEnabled,
                ADMIN_API_KEY: adminApiKey,
                RATE_LIMIT_ENABLED: rateLimitEnabled,
                RATE_LIMIT_WINDOW_MS: 60_000,
                RATE_LIMIT_MAX: rateLimitMax,
              };
              return overrides[key];
            },
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    isAdminEnabled = true;
    adminApiKey = undefined;
    rateLimitEnabled = false;
    rateLimitMax = 1;
    reset.mockReset();
    reset.mockResolvedValue(STATUS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 200 with exactly the flash sale status keys', async () => {
    const response = await request(app.getHttpServer()).post(RESET_PATH).send({ totalStock: 7 });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(RESPONSE_KEYS);
    expect(response.body.startsAt).toBe(new Date(STATUS.startsAtMs).toISOString());
  });

  it('hands the validated body to the reset service', async () => {
    const body = {
      totalStock: 5,
      startsOffsetSeconds: -60,
      durationSeconds: 3600,
    };

    await request(app.getHttpServer()).post(RESET_PATH).send(body);

    expect(reset).toHaveBeenCalledWith(body);
  });

  it('answers 200 for an empty object body', async () => {
    const response = await request(app.getHttpServer()).post(RESET_PATH).send({});

    expect(response.status).toBe(200);
    expect(reset).toHaveBeenCalledWith({});
  });

  it('answers 415 when no body and no content-type are sent', async () => {
    const response = await request(app.getHttpServer()).post(RESET_PATH);

    expect(response.status).toBe(415);
    expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(reset).not.toHaveBeenCalled();
  });

  it('answers 415 and skips the service when content-type is text/plain', async () => {
    const response = await request(app.getHttpServer())
      .post(RESET_PATH)
      .set('content-type', 'text/plain')
      .send('{}');

    expect(response.status).toBe(415);
    expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(reset).not.toHaveBeenCalled();
  });

  it.each([
    { totalStock: -1 },
    { totalStock: 1.5 },
    { totalStock: 'x' },
    { totalStock: '5' },
    { durationSeconds: 0 },
    { startsOffsetSeconds: 31_536_001 },
    { startsAt: '2030-01-01T10:00:00' },
    { endsAt: '2030-01-01' },
    { productName: 'X' },
    { surprise: true },
  ])('answers 400 and skips the service for the body %j', async (body) => {
    const response = await request(app.getHttpServer()).post(RESET_PATH).send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(reset).not.toHaveBeenCalled();
  });

  it('rate limits reset requests via RateLimitGuard when enabled', async () => {
    rateLimitEnabled = true;
    rateLimitMax = 1;

    const first = await request(app.getHttpServer()).post(RESET_PATH).send({});
    const second = await request(app.getHttpServer()).post(RESET_PATH).send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('answers 404 and skips the service when admin endpoints are disabled', async () => {
    isAdminEnabled = false;
    adminApiKey = 'top-secret';

    const response = await request(app.getHttpServer()).post(RESET_PATH).send({});

    expect(response.status).toBe(404);
    expect(reset).not.toHaveBeenCalled();
  });

  it.each([
    ['missing x-admin-key', undefined],
    ['different-length x-admin-key', 'wrong'],
    ['same-length wrong x-admin-key', 'top-secreX'],
  ])('answers 401 UNAUTHORIZED when ADMIN_API_KEY is set with %s', async (_label, header) => {
    adminApiKey = 'top-secret';
    const req = request(app.getHttpServer()).post(RESET_PATH).send({});
    if (header !== undefined) req.set('x-admin-key', header);

    const response = await req;

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      code: ERROR_CODES.UNAUTHORIZED,
      message: UNAUTHORIZED_ADMIN_MESSAGE,
    });
    expect(reset).not.toHaveBeenCalled();
  });

  it('answers 200 when ADMIN_API_KEY is set and x-admin-key matches', async () => {
    adminApiKey = 'top-secret';

    const response = await request(app.getHttpServer())
      .post(RESET_PATH)
      .set('x-admin-key', 'top-secret')
      .send({});

    expect(response.status).toBe(200);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
