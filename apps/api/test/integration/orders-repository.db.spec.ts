import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DATABASE_STATEMENT_TIMEOUT_MS } from '../../src/infrastructure/database/database.constants';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { CONFIRMED_ORDER_STATUS } from '../../src/modules/orders/constants/orders.constants';
import { OrderPersistenceRejectedError } from '../../src/modules/orders/errors/order-persistence-rejected.error';
import type { ConfirmedBatchCursor } from '../../src/modules/orders/interfaces/order.interface';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import type { ConfirmedReservation, ReservationRef } from '../../src/modules/sale-ledger';
import { createSaleDbHarness, type SaleDbHarness } from '../support/sale-db.harness';
import { settleWithin } from '../support/settle-within';
import { userIdOf } from '../support/user-id.fixtures';

const TOTAL_STOCK = 10;
const CHECK_VIOLATION = '23514';
const STOCK_BOUNDS_CONSTRAINT = 'ck_flash_sales_remaining_stock_bounds';
const QUERY_CANCELED = '57014';
const LOCK_WAIT_SLACK_MS = 3000;

describe('OrdersRepository', () => {
  let moduleRef: TestingModule;
  let db: SaleDbHarness;
  let repository: OrdersRepository;

  async function seedSale(remainingStock: number): Promise<string> {
    const saleId = randomUUID();
    await db.seedSale(saleId, remainingStock, TOTAL_STOCK);
    return saleId;
  }

  function refOf(saleId: string, user = 'alice'): ReservationRef {
    return { saleId, userId: userIdOf(user), orderId: randomUUID() };
  }

  beforeAll(async () => {
    db = await createSaleDbHarness();
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [OrdersRepository],
    }).compile();
    await moduleRef.init();
    repository = moduleRef.get(OrdersRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
    await db.close();
  });

  describe('persistConfirmedOrder', () => {
    it('inserts a CONFIRMED row with the sale product and decrements remaining_stock once', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);

      const result = await repository.persistConfirmedOrder(ref);

      expect(result).toEqual({ outcome: 'INSERTED', orderId: ref.orderId });
      expect(await db.ordersOf(saleId)).toEqual([
        { id: ref.orderId, user_id: 'alice', status: CONFIRMED_ORDER_STATUS },
      ]);
      expect(await db.orderProductIds(saleId)).toEqual([db.productId]);
      expect(await db.stockOf(saleId)).toBe(4);
    });

    it('returns ALREADY_PERSISTED with the same id and leaves stock alone on a repeated ref', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);
      await repository.persistConfirmedOrder(ref);

      const result = await repository.persistConfirmedOrder(ref);

      expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: ref.orderId });
      expect(await db.ordersOf(saleId)).toHaveLength(1);
      expect(await db.stockOf(saleId)).toBe(4);
    });

    it('returns the original order id when the same user arrives with another orderId', async () => {
      const saleId = await seedSale(5);
      const first = refOf(saleId);
      await repository.persistConfirmedOrder(first);

      const result = await repository.persistConfirmedOrder({ ...first, orderId: randomUUID() });

      expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: first.orderId });
      expect(await db.stockOf(saleId)).toBe(4);
    });

    it('persists exactly one row and one decrement for parallel retries of one reservation', async () => {
      const saleId = await seedSale(5);
      const ref = refOf(saleId);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => repository.persistConfirmedOrder(ref)),
      );

      expect(results.filter((r) => r.outcome === 'INSERTED')).toHaveLength(1);
      expect(await db.ordersOf(saleId)).toHaveLength(1);
      expect(await db.stockOf(saleId)).toBe(4);
    });

    it('rejects as STOCK_INVARIANT_VIOLATION and leaves no row when remaining_stock is 0', async () => {
      const saleId = await seedSale(0);
      const ref = refOf(saleId);

      const attempt = repository.persistConfirmedOrder(ref);

      await expect(attempt).rejects.toBeInstanceOf(OrderPersistenceRejectedError);
      await expect(attempt).rejects.toMatchObject({
        reason: 'STOCK_INVARIANT_VIOLATION',
        orderId: ref.orderId,
      });
      expect(await db.ordersOf(saleId)).toEqual([]);
      expect(await db.stockOf(saleId)).toBe(0);
    });

    it('rejects when the sale row does not exist instead of reporting success', async () => {
      const ref = refOf(randomUUID());

      const attempt = repository.persistConfirmedOrder(ref);

      await expect(attempt).rejects.toBeInstanceOf(OrderPersistenceRejectedError);
      await expect(attempt).rejects.toMatchObject({
        reason: 'SALE_NOT_FOUND',
        orderId: ref.orderId,
      });
    });

    it(
      'rejects within the statement timeout while another session holds the sale row lock',
      async () => {
        const saleId = await seedSale(5);
        const release = await db.lockSaleRow(saleId);

        try {
          const outcome = await settleWithin(
            repository.persistConfirmedOrder(refOf(saleId)),
            DATABASE_STATEMENT_TIMEOUT_MS + LOCK_WAIT_SLACK_MS,
          );

          expect(outcome).toMatchObject({ code: QUERY_CANCELED });
        } finally {
          await release();
        }
        expect(await db.ordersOf(saleId)).toEqual([]);
      },
      DATABASE_STATEMENT_TIMEOUT_MS + 2 * LOCK_WAIT_SLACK_MS,
    );

    it('lets the database refuse a negative remaining_stock through the bounds check', async () => {
      const saleId = await seedSale(1);

      const attempt = db.query('UPDATE flash_sales SET remaining_stock = -1 WHERE id = $1', [
        saleId,
      ]);

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

  describe('hasConfirmedOrders and listConfirmedBatch', () => {
    it('reports whether confirmed orders exist for a sale', async () => {
      const saleId = await seedSale(5);
      expect(await repository.hasConfirmedOrders(saleId)).toBe(false);
      await repository.persistConfirmedOrder(refOf(saleId));
      expect(await repository.hasConfirmedOrders(saleId)).toBe(true);
    });

    it('pages across confirmed orders via keyset cursor', async () => {
      const saleId = await seedSale(10);
      const refs = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'].map((u) => refOf(saleId, u));
      for (const ref of refs) await repository.persistConfirmedOrder(ref);

      const collected: ConfirmedReservation[] = [];
      let cursor: ConfirmedBatchCursor | undefined;
      do {
        const page = await repository.listConfirmedBatch({ saleId, limit: 2, cursor });
        collected.push(...page.entries);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      expect(collected).toHaveLength(5);
      expect(new Set(collected.map((entry) => entry.orderId))).toEqual(
        new Set(refs.map((ref) => ref.orderId)),
      );
    });
  });
});
