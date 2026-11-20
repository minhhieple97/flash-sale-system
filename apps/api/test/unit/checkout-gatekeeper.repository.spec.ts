import { randomUUID } from 'node:crypto';
import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../../src/infrastructure/redis/redis.constants';
import type { FlashSaleRedis } from '../../src/infrastructure/redis/redis.interfaces';
import type { ExecuteReservationParams } from '../../src/modules/checkout/interfaces/checkout.interface';
import { CheckoutGatekeeperRepository } from '../../src/modules/checkout/repositories/checkout-gatekeeper.repository';

const NOW_MS = 1_800_000_000_000;

describe('CheckoutGatekeeperRepository', () => {
  const params: ExecuteReservationParams = {
    saleId: 'sale-1',
    userId: 'alice' as NormalizedUserId,
    orderId: randomUUID(),
    nowMs: NOW_MS,
  };

  function build(reply: unknown): {
    repository: CheckoutGatekeeperRepository;
    attemptPurchase: jest.Mock;
  } {
    const attemptPurchase = jest.fn().mockResolvedValue(reply);
    const redis = { attemptPurchase } as unknown as FlashSaleRedis;
    return { repository: new CheckoutGatekeeperRepository(redis), attemptPurchase };
  }

  it('passes config, stock and users keys, then user id, now and order id, in that order', async () => {
    const { repository, attemptPurchase } = build('RESERVED');

    await repository.executeAtomicReservation(params);

    expect(attemptPurchase).toHaveBeenCalledTimes(1);
    expect(attemptPurchase).toHaveBeenCalledWith(
      flashSaleConfigKey(params.saleId),
      flashSaleStockKey(params.saleId),
      flashSaleUsersKey(params.saleId),
      params.userId,
      NOW_MS,
      params.orderId,
    );
  });

  it.each([
    'RESERVED',
    'ALREADY_PURCHASED',
    'SOLD_OUT',
    'SALE_UPCOMING',
    'SALE_ENDED',
    'SALE_NOT_CONFIGURED',
  ])('returns the %s reply as the verdict', async (reply) => {
    const { repository } = build(reply);

    const verdict = await repository.executeAtomicReservation(params);

    expect(verdict).toBe(reply);
  });

  it.each([['WAT'], [42], [null], ['constructor']])(
    'rejects the unknown reply %p',
    async (reply) => {
      const { repository } = build(reply);

      await expect(repository.executeAtomicReservation(params)).rejects.toThrow(
        /unexpected attemptPurchase reply/i,
      );
    },
  );
});
