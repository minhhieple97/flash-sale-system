import { Logger } from '@nestjs/common';
import {
  buildPersistenceWithMetrics,
  PERSISTENCE_REF as REF,
} from '../support/order-persistence.mocks';

describe('OrderPersistenceService mid-restore adoption retry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws a retryable error when adoption fails while the ledger is rebuilding', async () => {
    const { service, cache, outcomes } = buildPersistenceWithMetrics();
    cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
    cache.adoptCommittedOrder.mockResolvedValue('NOT_ADOPTED');
    cache.isIntact.mockResolvedValue(false);
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(service.persistReservedOrder(REF)).rejects.toThrow(
      `Sale ${REF.saleId} ledger is rebuilding; retrying adoption for ${REF.orderId}`,
    );
    expect(cache.isIntact).toHaveBeenCalledWith(REF.saleId);
    expect(outcomes()).toEqual(['FAILED']);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('logs an error and completes when adoption fails on an intact ledger', async () => {
    const { service, cache, outcomes } = buildPersistenceWithMetrics();
    cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
    cache.adoptCommittedOrder.mockResolvedValue('NOT_ADOPTED');
    cache.isIntact.mockResolvedValue(true);
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const result = await service.persistReservedOrder(REF);

    expect(result).toEqual({ outcome: 'INSERTED', orderId: REF.orderId });
    expect(outcomes()).toEqual(['INSERTED']);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('adopts a committed order on retry when the slot is absent after restoreSale completes', async () => {
    const { service, orders, cache, outcomes } = buildPersistenceWithMetrics();
    cache.findSlot.mockResolvedValue({ status: 'NONE' });
    orders.findConfirmedOrderId.mockResolvedValue(REF.orderId);
    cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
    cache.adoptCommittedOrder.mockResolvedValue('ADOPTED');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const result = await service.persistReservedOrder(REF);

    expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: REF.orderId });
    expect(orders.persistConfirmedOrder).not.toHaveBeenCalled();
    expect(cache.adoptCommittedOrder).toHaveBeenCalledWith(REF);
    expect(outcomes()).toEqual(['ALREADY_PERSISTED']);
  });

  it('keeps retrying on non-live slot if PG holds the matching order while ledger still rebuilds', async () => {
    const { service, orders, cache, outcomes } = buildPersistenceWithMetrics();
    cache.findSlot.mockResolvedValue({ status: 'NONE' });
    orders.findConfirmedOrderId.mockResolvedValue(REF.orderId);
    cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
    cache.adoptCommittedOrder.mockResolvedValue('NOT_ADOPTED');
    cache.isIntact.mockResolvedValue(false);

    await expect(service.persistReservedOrder(REF)).rejects.toThrow(
      `Sale ${REF.saleId} ledger is rebuilding; retrying adoption for ${REF.orderId}`,
    );
    expect(outcomes()).toEqual(['FAILED']);
  });

  it('returns STALE without adopting when PG holds a different orderId for the user', async () => {
    const { service, orders, cache, outcomes } = buildPersistenceWithMetrics();
    cache.findSlot.mockResolvedValue({ status: 'NONE' });
    orders.findConfirmedOrderId.mockResolvedValue('another-order-id');

    const result = await service.persistReservedOrder(REF);

    expect(result).toEqual({ outcome: 'STALE', orderId: REF.orderId });
    expect(orders.persistConfirmedOrder).not.toHaveBeenCalled();
    expect(cache.confirmReservation).not.toHaveBeenCalled();
    expect(cache.adoptCommittedOrder).not.toHaveBeenCalled();
    expect(outcomes()).toEqual(['STALE']);
  });

  it('throws a retryable error in compensateFailedOrder when ledger is rebuilding', async () => {
    const { service, orders, cache, outcomes } = buildPersistenceWithMetrics();
    orders.findConfirmedOrderId.mockResolvedValue('stored-order');
    cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
    cache.adoptCommittedOrder.mockResolvedValue('NOT_ADOPTED');
    cache.isIntact.mockResolvedValue(false);

    await expect(service.compensateFailedOrder(REF)).rejects.toThrow(
      `Sale ${REF.saleId} ledger is rebuilding; retrying adoption for stored-order`,
    );
    expect(outcomes()).toEqual(['FAILED']);
  });
});
