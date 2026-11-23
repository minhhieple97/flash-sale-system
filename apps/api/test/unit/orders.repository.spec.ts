import type { DataSource } from 'typeorm';
import { CONFIRMED_ORDER_STATUS } from '../../src/modules/orders/constants/orders.constants';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';

describe('OrdersRepository (unit)', () => {
  it('orders the first page by qualified table columns rather than the text alias', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: 'order-1',
        user_id: 'alice@example.com',
        created_at: '2030-01-01 00:00:01+00',
      },
    ]);
    const repository = new OrdersRepository({ query } as unknown as DataSource);

    const page = await repository.listConfirmedBatch({ saleId: 'sale-1', limit: 2 });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ORDER BY orders.created_at, orders.id');
    expect(params).toEqual(['sale-1', CONFIRMED_ORDER_STATUS, 3]);
    expect(page).toEqual({
      entries: [{ userId: 'alice@example.com', orderId: 'order-1' }],
      nextCursor: null,
    });
  });

  it('casts the keyset cursor to timestamptz and orders by qualified table columns', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: 'order-2',
        user_id: 'bob@example.com',
        created_at: '2030-01-01 00:00:02+00',
      },
    ]);
    const repository = new OrdersRepository({ query } as unknown as DataSource);
    const cursor = { createdAt: '2030-01-01 00:00:01+00', id: 'order-1' };

    const page = await repository.listConfirmedBatch({
      saleId: 'sale-1',
      limit: 2,
      cursor,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('(created_at, id) > ($3::timestamptz, $4)');
    expect(sql).toContain('ORDER BY orders.created_at, orders.id');
    expect(params).toEqual(['sale-1', CONFIRMED_ORDER_STATUS, cursor.createdAt, cursor.id, 3]);
    expect(page).toEqual({
      entries: [{ userId: 'bob@example.com', orderId: 'order-2' }],
      nextCursor: null,
    });
  });
});
