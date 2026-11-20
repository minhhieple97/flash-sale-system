import { NotFoundException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { FlashSalesController } from '../../src/modules/flash-sales/controllers/flash-sales.controller';
import type { FlashSaleStatus } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import { buildSnapshot } from '../support/flash-sale.fixtures';

const STARTS_AT_MS = Date.UTC(2030, 0, 1, 0, 0, 0);
const ENDS_AT_MS = Date.UTC(2030, 0, 1, 1, 0, 0);
const SERVER_MS = Date.UTC(2030, 0, 1, 0, 30, 0);
const STATUS: FlashSaleStatus = {
  ...buildSnapshot({ startsAtMs: STARTS_AT_MS, endsAtMs: ENDS_AT_MS }),
  saleState: 'ACTIVE',
  serverTimeMs: SERVER_MS,
};
const DTO_KEYS = [
  'endsAt',
  'originalPriceCents',
  'productId',
  'productName',
  'remainingStock',
  'saleId',
  'salePriceCents',
  'saleState',
  'serverTime',
  'startsAt',
  'totalStock',
];

describe('FlashSalesController', () => {
  let app: NestFastifyApplication;
  const getCurrentStatus = jest.fn<Promise<FlashSaleStatus>, []>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FlashSalesController],
      providers: [{ provide: FlashSalesService, useValue: { getCurrentStatus } }],
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

  it('maps epoch milliseconds to ISO-8601 strings', async () => {
    getCurrentStatus.mockResolvedValue(STATUS);

    const response = await request(app.getHttpServer()).get('/api/v1/flash-sales/current');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      startsAt: '2030-01-01T00:00:00.000Z',
      endsAt: '2030-01-01T01:00:00.000Z',
      serverTime: '2030-01-01T00:30:00.000Z',
    });
  });

  it('answers with exactly the DTO keys', async () => {
    getCurrentStatus.mockResolvedValue(STATUS);

    const response = await request(app.getHttpServer()).get('/api/v1/flash-sales/current');

    expect(Object.keys(response.body).sort()).toEqual(DTO_KEYS);
  });

  it('answers 404 FLASH_SALE_NOT_FOUND when the service throws', async () => {
    getCurrentStatus.mockRejectedValue(
      new NotFoundException({ code: 'FLASH_SALE_NOT_FOUND', message: 'none' }),
    );

    const response = await request(app.getHttpServer()).get('/api/v1/flash-sales/current');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'FLASH_SALE_NOT_FOUND', message: 'none' });
  });
});
