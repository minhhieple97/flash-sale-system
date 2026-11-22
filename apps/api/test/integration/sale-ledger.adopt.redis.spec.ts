import { randomUUID } from 'node:crypto';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { flashSaleStockKey, flashSaleUsersKey } from '../support/ledger-keys';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';
import { userIdOf } from '../support/user-id.fixtures';

interface LedgerUnits {
  stock: string | null;
  users: Record<string, string>;
}

describe('SaleLedgerRepository.adoptCommittedOrder', () => {
  let harness: SaleLedgerHarness;

  beforeAll(async () => {
    harness = await createSaleLedgerHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const committedOrder = (saleId: string): ReservationRef => ({
    saleId,
    userId: userIdOf('alice'),
    orderId: randomUUID(),
  });

  async function readUnits(saleId: string): Promise<LedgerUnits> {
    return {
      stock: await harness.redis.get(flashSaleStockKey(saleId)),
      users: await harness.redis.hgetall(flashSaleUsersKey(saleId)),
    };
  }

  it('confirms an absent entry with the committed order and takes one stock unit', async () => {
    const saleId = await harness.seedSale(2);
    const order = committedOrder(saleId);

    const outcome = await harness.ledger.adoptCommittedOrder(order);

    expect(outcome).toBe('ADOPTED');
    expect(await readUnits(saleId)).toEqual({
      stock: '1',
      users: { [order.userId]: `CONFIRMED:${order.orderId}` },
    });
  });

  it('answers ADOPTED to a resend without taking a second unit', async () => {
    const saleId = await harness.seedSale(2);
    const order = committedOrder(saleId);
    await harness.ledger.adoptCommittedOrder(order);

    const resend = await harness.ledger.adoptCommittedOrder(order);

    expect(resend).toBe('ADOPTED');
    expect((await readUnits(saleId)).stock).toBe('1');
  });

  it('writes nothing when the stock is already 0', async () => {
    const saleId = await harness.seedSale(0);
    const order = committedOrder(saleId);

    const outcome = await harness.ledger.adoptCommittedOrder(order);

    expect(outcome).toBe('NOT_ADOPTED');
    expect(await readUnits(saleId)).toEqual({ stock: '0', users: {} });
  });

  it.each([
    ['reserved', 'RESERVED:'],
    ['confirmed', 'CONFIRMED:'],
  ])('writes nothing when the entry is %s by another order', async (_state, prefix) => {
    const saleId = await harness.seedSale(2);
    const order = committedOrder(saleId);
    const held = `${prefix}${randomUUID()}`;
    await harness.redis.hset(flashSaleUsersKey(saleId), order.userId, held);

    const outcome = await harness.ledger.adoptCommittedOrder(order);

    expect(outcome).toBe('NOT_ADOPTED');
    expect(await readUnits(saleId)).toEqual({ stock: '2', users: { [order.userId]: held } });
  });

  it('writes nothing and leaves a lost stock key missing for the restore to derive', async () => {
    const saleId = await harness.seedSale(2);
    await harness.redis.del(flashSaleStockKey(saleId));
    const order = committedOrder(saleId);

    const outcome = await harness.ledger.adoptCommittedOrder(order);

    expect(outcome).toBe('NOT_ADOPTED');
    expect(await readUnits(saleId)).toEqual({ stock: null, users: {} });
  });
});
