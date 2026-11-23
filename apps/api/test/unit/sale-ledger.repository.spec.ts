import { randomUUID } from 'node:crypto';
import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { type AttemptPurchaseParams, SaleLedgerRepository } from '../../src/modules/sale-ledger';
import {
  flashSaleConfigKey,
  flashSaleMaintenanceLockKey,
  flashSalePendingKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  HYDRATION_BATCH_SIZE,
  RELEASE_LOCK_REPLY,
  RESTORE_CONFIRMED_BATCH_REPLY,
  type SaleLedgerRedis,
} from '../support/ledger-keys';

const NOW_MS = 1_800_000_000_000;

describe('SaleLedgerRepository.reserve', () => {
  const params: AttemptPurchaseParams = {
    saleId: 'sale-1',
    userId: 'alice' as NormalizedUserId,
    orderId: randomUUID(),
    nowMs: NOW_MS,
  };

  function build(reply: unknown): {
    repository: SaleLedgerRepository;
    attemptPurchase: jest.Mock;
  } {
    const attemptPurchase = jest.fn().mockResolvedValue(reply);
    const redis = { attemptPurchase } as unknown as SaleLedgerRedis;
    return { repository: new SaleLedgerRepository(redis), attemptPurchase };
  }

  it('passes config, stock, users and pending keys, then user id, now and order id', async () => {
    const { repository, attemptPurchase } = build('RESERVED');

    await repository.reserve(params);

    expect(attemptPurchase).toHaveBeenCalledTimes(1);
    expect(attemptPurchase).toHaveBeenCalledWith(
      flashSaleConfigKey(params.saleId),
      flashSaleStockKey(params.saleId),
      flashSaleUsersKey(params.saleId),
      flashSalePendingKey(params.saleId),
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

    const verdict = await repository.reserve(params);

    expect(verdict).toBe(reply);
  });

  it.each([['WAT'], [42], [null], ['constructor']])(
    'rejects the unknown reply %p',
    async (reply) => {
      const { repository } = build(reply);

      await expect(repository.reserve(params)).rejects.toThrow(/unexpected attemptPurchase reply/i);
    },
  );
});

describe('sale-ledger cluster key builders and constants', () => {
  it('tags all per-sale keys with {saleId} so multi-key commands stay in one hash slot', () => {
    expect(flashSaleConfigKey('sale-1')).toBe('flash_sale:{sale-1}:config');
    expect(flashSaleStockKey('sale-1')).toBe('flash_sale:{sale-1}:stock');
    expect(flashSaleUsersKey('sale-1')).toBe('flash_sale:{sale-1}:users');
    expect(flashSalePendingKey('sale-1')).toBe('flash_sale:{sale-1}:pending');
    expect(flashSaleMaintenanceLockKey('sale-1')).toBe('flash_sale:{sale-1}:maintenance_lock');
  });

  it('defines batching and script reply constants', () => {
    expect(HYDRATION_BATCH_SIZE).toBe(1_000);
    expect(RESTORE_CONFIRMED_BATCH_REPLY).toEqual({ WROTE: 1, NOOP: 0 });
    expect(RELEASE_LOCK_REPLY).toEqual({ RELEASED: 1, NOT_OWNER: 0 });
  });
});

describe('SaleLedgerRepository.invalidateState', () => {
  it('deletes config, stock, users and pending keys together in one DEL call', async () => {
    const del = jest.fn().mockResolvedValue(4);
    const repository = new SaleLedgerRepository({ del } as unknown as SaleLedgerRedis);

    await repository.invalidateState('sale-1');

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(
      flashSaleConfigKey('sale-1'),
      flashSaleStockKey('sale-1'),
      flashSaleUsersKey('sale-1'),
      flashSalePendingKey('sale-1'),
    );
  });
});
