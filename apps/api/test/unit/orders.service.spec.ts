import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrdersService } from '../../src/modules/orders/services/orders.service';
import type {
  ReservationSlot,
  SaleLedgerRepository,
  SlotReadWithLedgerState,
} from '../../src/modules/sale-ledger';
import { userIdOf } from '../support/user-id.fixtures';

function buildService(
  slot: ReservationSlot,
  options: { isLedgerIntact?: boolean; persistedOrderId?: string | null } = {},
) {
  const { isLedgerIntact = true, persistedOrderId = null } = options;
  const readSlotWithLedgerState = jest.fn<Promise<SlotReadWithLedgerState>, [string, string]>();
  readSlotWithLedgerState.mockResolvedValue({ slot, isLedgerIntact });
  const findConfirmedOrderId = jest.fn<Promise<string | null>, [string, string]>();
  findConfirmedOrderId.mockResolvedValue(persistedOrderId);
  const service = new OrdersService(
    { findConfirmedOrderId } as unknown as OrdersRepository,
    { readSlotWithLedgerState } as unknown as SaleLedgerRepository,
  );
  return { service, readSlotWithLedgerState, findConfirmedOrderId };
}

describe('OrdersService.getUserOrderStatus', () => {
  const userId = userIdOf('alice');

  it.each<ReservationSlot>([
    { status: 'RESERVED', orderId: 'order-1' },
    { status: 'CONFIRMED', orderId: 'order-2' },
  ])('answers a cached $status slot without a database call', async (slot) => {
    const { service, findConfirmedOrderId } = buildService(slot);

    const status = await service.getUserOrderStatus(userId);

    expect(status).toEqual({ ...slot, userId });
    expect(findConfirmedOrderId).not.toHaveBeenCalled();
  });

  it('answers NONE without querying the database when slot is NONE and ledger is intact', async () => {
    const { service, readSlotWithLedgerState, findConfirmedOrderId } = buildService(
      { status: 'NONE' },
      { isLedgerIntact: true, persistedOrderId: 'order-3' },
    );

    const status = await service.getUserOrderStatus(userId);

    expect(status).toEqual({ status: 'NONE', userId });
    expect(readSlotWithLedgerState).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, userId);
    expect(findConfirmedOrderId).not.toHaveBeenCalled();
  });

  it('falls back to the database on a NONE slot when ledger is not intact and reports CONFIRMED', async () => {
    const { service, findConfirmedOrderId } = buildService(
      { status: 'NONE' },
      { isLedgerIntact: false, persistedOrderId: 'order-3' },
    );

    const status = await service.getUserOrderStatus(userId);

    expect(status).toEqual({ status: 'CONFIRMED', orderId: 'order-3', userId });
    expect(findConfirmedOrderId).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, userId);
  });

  it('reports NONE when ledger is not intact and the database has no order', async () => {
    const { service, readSlotWithLedgerState, findConfirmedOrderId } = buildService(
      { status: 'NONE' },
      { isLedgerIntact: false, persistedOrderId: null },
    );

    const status = await service.getUserOrderStatus(userId);

    expect(status).toEqual({ status: 'NONE', userId });
    expect(readSlotWithLedgerState).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, userId);
    expect(findConfirmedOrderId).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, userId);
  });
});

describe('OrdersService hydration queries', () => {
  it('checks hasConfirmedOrders and pages listConfirmedBatch via the repository', async () => {
    const hasConfirmedOrders = jest.fn(async () => true);
    const page = { entries: [], nextCursor: null };
    const listConfirmedBatch = jest.fn(async () => page);
    const service = new OrdersService(
      { hasConfirmedOrders, listConfirmedBatch } as unknown as OrdersRepository,
      {} as SaleLedgerRepository,
    );

    expect(await service.hasConfirmedOrders('sale-9')).toBe(true);
    expect(await service.listConfirmedBatch({ saleId: 'sale-9', limit: 50 })).toBe(page);
    expect(hasConfirmedOrders).toHaveBeenCalledWith('sale-9');
    expect(listConfirmedBatch).toHaveBeenCalledWith({ saleId: 'sale-9', limit: 50 });
  });
});
