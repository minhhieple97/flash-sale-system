import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type {
  ConfirmedReservation,
  LedgerHydrationResult,
  ReservationSlot,
  SaleLedgerState,
} from '../../src/modules/orders/interfaces/order.interface';
import type { OrderCacheRepository } from '../../src/modules/orders/repositories/order-cache.repository';
import type { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrdersService } from '../../src/modules/orders/services/orders.service';
import { buildSnapshot } from '../support/flash-sale.fixtures';
import { userIdOf } from '../support/user-id.fixtures';

function buildService(slot: ReservationSlot, persistedOrderId: string | null = null) {
  const findSlot = jest.fn<Promise<ReservationSlot>, [string, string]>();
  findSlot.mockResolvedValue(slot);
  const findConfirmedOrderId = jest.fn<Promise<string | null>, [string, string]>();
  findConfirmedOrderId.mockResolvedValue(persistedOrderId);
  const service = new OrdersService(
    { findConfirmedOrderId } as unknown as OrdersRepository,
    { findSlot } as unknown as OrderCacheRepository,
  );
  return { service, findSlot, findConfirmedOrderId };
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

  it('falls back to the database on a NONE slot and reports its order as CONFIRMED', async () => {
    const { service } = buildService({ status: 'NONE' }, 'order-3');

    const status = await service.getUserOrderStatus(userId);

    expect(status).toEqual({ status: 'CONFIRMED', orderId: 'order-3', userId });
  });

  it('reports NONE when neither the cache nor the database knows the user', async () => {
    const { service } = buildService({ status: 'NONE' }, null);

    const status = await service.getUserOrderStatus(userId);

    expect(status).toEqual({ status: 'NONE', userId });
  });

  it('reads the active flash sale from both stores and echoes the user id', async () => {
    const { service, findSlot, findConfirmedOrderId } = buildService({ status: 'NONE' });

    await service.getUserOrderStatus(userId);

    expect(findSlot).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, userId);
    expect(findConfirmedOrderId).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, userId);
  });
});

describe('OrdersService ledger delegation', () => {
  const state: SaleLedgerState = { snapshot: buildSnapshot({ saleId: 'sale-9' }), confirmed: [] };

  function buildLedgerService() {
    const listConfirmed = jest.fn<Promise<readonly ConfirmedReservation[]>, [string]>();
    const hydrateIfAbsent = jest.fn<Promise<LedgerHydrationResult>, [SaleLedgerState]>();
    const replaceState = jest.fn<Promise<void>, [SaleLedgerState]>();
    const service = new OrdersService(
      { listConfirmed } as unknown as OrdersRepository,
      { hydrateIfAbsent, replaceState } as unknown as OrderCacheRepository,
    );
    return { service, listConfirmed, hydrateIfAbsent, replaceState };
  }

  it('lists confirmed reservations straight from the orders table', async () => {
    const { service, listConfirmed } = buildLedgerService();
    const confirmed = [{ userId: userIdOf('alice'), orderId: 'order-1' }];
    listConfirmed.mockResolvedValue(confirmed);

    const result = await service.listConfirmedReservations('sale-9');

    expect(result).toBe(confirmed);
    expect(listConfirmed).toHaveBeenCalledWith('sale-9');
  });

  it.each<LedgerHydrationResult>(['HYDRATED', 'ALREADY_PRESENT'])(
    'returns %s from the cache hydration unchanged',
    async (outcome) => {
      const { service, hydrateIfAbsent } = buildLedgerService();
      hydrateIfAbsent.mockResolvedValue(outcome);

      const result = await service.hydrateSaleState(state);

      expect(result).toBe(outcome);
      expect(hydrateIfAbsent).toHaveBeenCalledWith(state);
    },
  );

  it('overwrites the cached sale state with the given ledger state', async () => {
    const { service, replaceState } = buildLedgerService();
    replaceState.mockResolvedValue(undefined);

    await service.replaceSaleState(state);

    expect(replaceState).toHaveBeenCalledWith(state);
  });
});
