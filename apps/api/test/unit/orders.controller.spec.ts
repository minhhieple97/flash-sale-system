import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { OrdersController } from '../../src/modules/orders/controllers/orders.controller';
import type { UserOrderStatus } from '../../src/modules/orders/interfaces/order.interface';
import { OrdersService } from '../../src/modules/orders/services/orders.service';
import { userIdOf } from '../support/user-id.fixtures';

const DTO_KEYS = ['hasPurchased', 'orderId', 'status', 'userId'];

describe('OrdersController', () => {
  let app: NestFastifyApplication;
  const getUserOrderStatus = jest.fn<Promise<UserOrderStatus>, [NormalizedUserId]>();
  const canActivate = jest.fn(() => true);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: { getUserOrderStatus } }],
    })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    getUserOrderStatus.mockReset();
    canActivate.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers with exactly the DTO keys', async () => {
    const userId = userIdOf('alice');
    getUserOrderStatus.mockResolvedValue({ status: 'CONFIRMED', orderId: 'order-1', userId });

    const response = await request(app.getHttpServer()).get('/api/v1/orders/user/alice');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(DTO_KEYS);
  });

  it.each<UserOrderStatus['status']>(['RESERVED', 'CONFIRMED'])(
    'reports a %s order as purchased with its orderId',
    async (status) => {
      const userId = userIdOf('alice');
      getUserOrderStatus.mockResolvedValue({ status, orderId: 'order-1', userId });

      const response = await request(app.getHttpServer()).get('/api/v1/orders/user/alice');

      expect(response.body).toEqual({
        userId: 'alice',
        hasPurchased: true,
        status,
        orderId: 'order-1',
      });
    },
  );

  it('reports NONE as not purchased with a null orderId', async () => {
    getUserOrderStatus.mockResolvedValue({ status: 'NONE', userId: userIdOf('alice') });

    const response = await request(app.getHttpServer()).get('/api/v1/orders/user/alice');

    expect(response.body).toEqual({
      userId: 'alice',
      hasPurchased: false,
      status: 'NONE',
      orderId: null,
    });
  });

  it('hands the service the normalized form of a URL-encoded raw user id', async () => {
    getUserOrderStatus.mockResolvedValue({ status: 'NONE', userId: userIdOf('alice@example.com') });

    await request(app.getHttpServer()).get(
      `/api/v1/orders/user/${encodeURIComponent(' ALICE@Example.com ')}`,
    );

    expect(getUserOrderStatus).toHaveBeenCalledWith('alice@example.com');
  });

  it('answers 400 INVALID_USER_ID and skips the service for an invalid id', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/orders/user/a!');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_USER_ID');
    expect(getUserOrderStatus).not.toHaveBeenCalled();
    expect(canActivate).toHaveBeenCalledTimes(1);
  });
});
