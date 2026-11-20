import { ServiceUnavailableException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import {
  ERROR_CODES,
  TEMPORARY_FAILURE_MESSAGE,
} from '../../src/common/constants/common.constants';
import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { CheckoutController } from '../../src/modules/checkout/controllers/checkout.controller';
import type {
  PurchaseAttemptResult,
  PurchaseRejectionCode,
} from '../../src/modules/checkout/interfaces/checkout.interface';
import { CheckoutService } from '../../src/modules/checkout/services/checkout.service';
import { userIdOf } from '../support/user-id.fixtures';

const PURCHASE_PATH = '/api/v1/checkout/purchase';
const ORDER_ID = '6f1c1d52-9a3e-4a55-8f45-6a8a1e2b0c11';
const REJECTION_STATUS: ReadonlyArray<[PurchaseRejectionCode, number]> = [
  ['ALREADY_PURCHASED', 409],
  ['SOLD_OUT', 410],
  ['SALE_UPCOMING', 422],
  ['SALE_ENDED', 422],
];

describe('CheckoutController', () => {
  let app: NestFastifyApplication;
  const attemptPurchase = jest.fn<Promise<PurchaseAttemptResult>, [NormalizedUserId]>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [{ provide: CheckoutService, useValue: { attemptPurchase } }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    attemptPurchase.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 202 with exactly code, message, orderId and userId for a reservation', async () => {
    attemptPurchase.mockResolvedValue({
      outcome: 'RESERVED',
      orderId: ORDER_ID,
      userId: userIdOf('alice'),
    });

    const response = await request(app.getHttpServer())
      .post(PURCHASE_PATH)
      .send({ userId: 'alice' });

    expect(response.status).toBe(202);
    expect(Object.keys(response.body).sort()).toEqual(['code', 'message', 'orderId', 'userId']);
    expect(response.body).toMatchObject({ code: 'RESERVED', orderId: ORDER_ID, userId: 'alice' });
  });

  it.each(REJECTION_STATUS)(
    'answers %s with status %i and exactly code and message',
    async (outcome, status) => {
      attemptPurchase.mockResolvedValue({ outcome });

      const response = await request(app.getHttpServer())
        .post(PURCHASE_PATH)
        .send({ userId: 'alice' });

      expect(response.status).toBe(status);
      expect(Object.keys(response.body).sort()).toEqual(['code', 'message']);
      expect(response.body.code).toBe(outcome);
    },
  );

  it.each([{ userId: 'a!' }, {}])(
    'answers 400 INVALID_USER_ID and skips the service for the body %j',
    async (body) => {
      const response = await request(app.getHttpServer()).post(PURCHASE_PATH).send(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_USER_ID');
      expect(attemptPurchase).not.toHaveBeenCalled();
    },
  );

  it('answers 503 TEMPORARY_FAILURE when the service signals an infrastructure fault', async () => {
    attemptPurchase.mockRejectedValue(
      new ServiceUnavailableException({
        code: ERROR_CODES.TEMPORARY_FAILURE,
        message: TEMPORARY_FAILURE_MESSAGE,
      }),
    );

    const response = await request(app.getHttpServer())
      .post(PURCHASE_PATH)
      .send({ userId: 'alice' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: 'TEMPORARY_FAILURE',
      message: TEMPORARY_FAILURE_MESSAGE,
    });
  });

  it('hands the service the normalized form of a raw user id', async () => {
    attemptPurchase.mockResolvedValue({ outcome: 'SOLD_OUT' });

    await request(app.getHttpServer()).post(PURCHASE_PATH).send({ userId: '  ALICE@example.com ' });

    expect(attemptPurchase).toHaveBeenCalledWith('alice@example.com');
  });
});
