import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import {
  CONFIRMED_ORDER_STATUS,
  ORDER_SALE_NOT_FOUND_MESSAGE,
  STOCK_INVARIANT_VIOLATION_MESSAGE,
} from '../../src/modules/orders/constants/orders.constants';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { userIdOf } from '../support/user-id.fixtures';

const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';
const TOTAL_STOCK = 10;
const CHECK_VIOLATION = '23514';
const STOCK_BOUNDS_CONSTRAINT = 'ck_flash_sales_remaining_stock_bounds';

interface OrderRow {
  id: string;
  product_id: string;
  user_id: string;
  status: string;
}

describe('OrdersRepository', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repository: OrdersRepository;
  const productId = randomUUID();
  const saleIds: string[] = [];

  async function seedSale(remainingStock: number): Promise<string> {
    const saleId = randomUUID();
    saleIds.push(saleId);
    await dataSource.query(
      `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [saleId, productId, TOTAL_STOCK, remainingStock, STARTS_AT, ENDS_AT],
    );
    return saleId;
  }

  function refOf(saleId: string, user = 'alice'): ReservationRef {
    return { saleId, userId: userIdOf(user), orderId: randomUUID() };
  }

  async function ordersOf(saleId: string): Promise<OrderRow[]> {
    return dataSource.query(
      'SELECT id, product_id, user_id, status FROM orders WHERE flash_sale_id = $1',
      [saleId],
    );
  }

  async function stockOf(saleId: string): Promise<number> {
    const rows: { remaining_stock: number }[] = await dataSource.query(
      'SELECT remaining_stock FROM flash_sales WHERE id = $1',
      [saleId],
    );
    return rows[0].remaining_stock;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [OrdersRepository],
    }).compile();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
    repository = moduleRef.get(OrdersRepository);
    await dataSource.query(
      `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents)
       VALUES ($1, $2, 'n', 'd', 100, 50)`,
      [productId, randomUUID()],
    );
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM flash_sales WHERE id = ANY($1::uuid[])', [saleIds]);
    await dataSource.query('DELETE FROM products WHERE id = $1', [productId]);
    await moduleRef.close();
  });

  describe('persistConfirmedOrder', () => {
    it('inserts a CONFIRMED row with the sale product and decrements remaining_stock once', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);

      const result = await repository.persistConfirmedOrder(ref);

      expect(result).toEqual({ outcome: 'INSERTED', orderId: ref.orderId });
      expect(await ordersOf(saleId)).toEqual([
        {
          id: ref.orderId,
          product_id: productId,
          user_id: 'alice',
          status: CONFIRMED_ORDER_STATUS,
        },
      ]);
      expect(await stockOf(saleId)).toBe(4);
    });

    it('returns ALREADY_PERSISTED with the same id and leaves stock alone on a repeated ref', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);
      await repository.persistConfirmedOrder(ref);

      const result = await repository.persistConfirmedOrder(ref);

      expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: ref.orderId });
      expect(await ordersOf(saleId)).toHaveLength(1);
      expect(await stockOf(saleId)).toBe(4);
    });

    it('returns the original order id when the same user arrives with another orderId', async () => {
      const saleId = await seedSale(5);
      const first = refOf(saleId);
      await repository.persistConfirmedOrder(first);

      const result = await repository.persistConfirmedOrder({ ...first, orderId: randomUUID() });

      expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: first.orderId });
      expect(await stockOf(saleId)).toBe(4);
    });

    it('persists exactly one row and one decrement for parallel retries of one reservation', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => repository.persistConfirmedOrder(ref)),
      );

      expect(results.filter((r) => r.outcome === 'INSERTED')).toHaveLength(1);
      expect(await ordersOf(saleId)).toHaveLength(1);
      expect(await stockOf(saleId)).toBe(4);
    });

    it('rejects with the invariant message and leaves no row when remaining_stock is 0', async () => {
      const saleId = await seedSale(0);

      const attempt = repository.persistConfirmedOrder(refOf(saleId));

      await expect(attempt).rejects.toThrow(STOCK_INVARIANT_VIOLATION_MESSAGE);
      expect(await ordersOf(saleId)).toEqual([]);
      expect(await stockOf(saleId)).toBe(0);
    });

    it('rejects when the sale row does not exist instead of reporting success', async () => {
      const attempt = repository.persistConfirmedOrder(refOf(randomUUID()));

      await expect(attempt).rejects.toThrow(ORDER_SALE_NOT_FOUND_MESSAGE);
    });

    it('lets the database refuse a negative remaining_stock through the bounds check', async () => {
      const saleId = await seedSale(1);

      const attempt = dataSource.query(
        'UPDATE flash_sales SET remaining_stock = -1 WHERE id = $1',
        [saleId],
      );

      await expect(attempt).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: STOCK_BOUNDS_CONSTRAINT,
      });
    });
  });

  describe('findConfirmedOrderId', () => {
    it('returns the order id of a persisted user', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);
      await repository.persistConfirmedOrder(ref);

      const orderId = await repository.findConfirmedOrderId(saleId, ref.userId);

      expect(orderId).toBe(ref.orderId);
    });

    it('returns null for a user without an order', async () => {
      const saleId = await seedSale(5);

      const orderId = await repository.findConfirmedOrderId(saleId, userIdOf('nobody'));

      expect(orderId).toBeNull();
    });
  });

  describe('listConfirmed', () => {
    it('lists only the orders of the requested sale with their user ids', async () => {
      const saleId = await seedSale(5);
      const otherSaleId = await seedSale(5);
      const alice = refOf(saleId, 'alice');
      const bob = refOf(saleId, 'bob');
      await repository.persistConfirmedOrder(alice);
      await repository.persistConfirmedOrder(bob);
      await repository.persistConfirmedOrder(refOf(otherSaleId, 'carol'));

      const confirmed = await repository.listConfirmed(saleId);

      expect(confirmed).toHaveLength(2);
      expect(confirmed).toEqual(
        expect.arrayContaining([
          { userId: alice.userId, orderId: alice.orderId },
          { userId: bob.userId, orderId: bob.orderId },
        ]),
      );
    });

    it('returns an empty list for a sale without orders', async () => {
      const saleId = await seedSale(5);

      const confirmed = await repository.listConfirmed(saleId);

      expect(confirmed).toEqual([]);
    });
  });

  describe('deleteBySale', () => {
    it('returns the number of deleted rows and removes only that sale orders', async () => {
      const saleId = await seedSale(5);
      const otherSaleId = await seedSale(5);
      await repository.persistConfirmedOrder(refOf(saleId, 'alice'));
      await repository.persistConfirmedOrder(refOf(saleId, 'bob'));
      await repository.persistConfirmedOrder(refOf(otherSaleId, 'carol'));

      const deleted = await repository.deleteBySale(saleId);

      expect(deleted).toBe(2);
      expect(await ordersOf(saleId)).toEqual([]);
      expect(await ordersOf(otherSaleId)).toHaveLength(1);
    });

    it('returns 0 when the sale has no orders', async () => {
      const saleId = await seedSale(5);

      const deleted = await repository.deleteBySale(saleId);

      expect(deleted).toBe(0);
    });
  });
});
