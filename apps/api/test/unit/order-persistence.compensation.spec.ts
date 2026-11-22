import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_COMPENSATION_JOB_OPTIONS,
} from '../../src/modules/orders/constants/orders.constants';
import {
  buildPersistenceService,
  PERSISTENCE_REF as REF,
} from '../support/order-persistence.mocks';

describe('OrderPersistenceService compensation', () => {
  describe('compensateFailedOrder', () => {
    it('asks PostgreSQL for the user order of the sale first', async () => {
      const { service, orders } = buildPersistenceService();

      await service.compensateFailedOrder(REF);

      expect(orders.findConfirmedOrderId).toHaveBeenCalledWith(REF.saleId, REF.userId);
    });

    it('marks the entry CONFIRMED with the stored id and never releases when an order exists', async () => {
      const { service, orders, cache } = buildPersistenceService();
      orders.findConfirmedOrderId.mockResolvedValue('stored-order');

      const outcome = await service.compensateFailedOrder(REF);

      expect(outcome).toBe('CONFIRMED');
      expect(cache.confirmReservation).toHaveBeenCalledWith(REF, 'stored-order');
      expect(cache.releaseReservation).not.toHaveBeenCalled();
    });

    it('adopts the stored order and reports CONFIRMED when PostgreSQL holds it but the entry was released', async () => {
      const { service, orders, cache } = buildPersistenceService();
      orders.findConfirmedOrderId.mockResolvedValue('stored-order');
      cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
      cache.adoptCommittedOrder.mockResolvedValue('ADOPTED');

      const outcome = await service.compensateFailedOrder(REF);

      expect(outcome).toBe('CONFIRMED');
      expect(cache.adoptCommittedOrder).toHaveBeenCalledWith({ ...REF, orderId: 'stored-order' });
      expect(cache.releaseReservation).not.toHaveBeenCalled();
    });

    it('returns NOT_RESERVED when PostgreSQL holds the order but the entry cannot be adopted', async () => {
      const { service, orders, cache } = buildPersistenceService();
      orders.findConfirmedOrderId.mockResolvedValue('stored-order');
      cache.confirmReservation.mockResolvedValue('NOT_RESERVED');

      const outcome = await service.compensateFailedOrder(REF);

      expect(outcome).toBe('NOT_RESERVED');
      expect(cache.releaseReservation).not.toHaveBeenCalled();
    });

    it('releases the reservation and reports RELEASED when no order exists', async () => {
      const { service, cache } = buildPersistenceService();

      const outcome = await service.compensateFailedOrder(REF);

      expect(outcome).toBe('RELEASED');
      expect(cache.releaseReservation).toHaveBeenCalledWith(REF);
      expect(cache.confirmReservation).not.toHaveBeenCalled();
    });

    it('reports NOT_RESERVED on a repeated call', async () => {
      const { service, cache } = buildPersistenceService();
      cache.releaseReservation
        .mockResolvedValueOnce('RELEASED')
        .mockResolvedValueOnce('NOT_RESERVED');

      await service.compensateFailedOrder(REF);
      const repeat = await service.compensateFailedOrder(REF);

      expect(repeat).toBe('NOT_RESERVED');
    });

    it('rejects without releasing when PostgreSQL cannot be asked, so BullMQ retries', async () => {
      const { service, orders, cache } = buildPersistenceService();
      orders.findConfirmedOrderId.mockRejectedValue(new Error('db down'));

      const outcome = service.compensateFailedOrder(REF);

      await expect(outcome).rejects.toThrow('db down');
      expect(cache.releaseReservation).not.toHaveBeenCalled();
    });

    it('rejects when the CONFIRMED write fails, so BullMQ retries', async () => {
      const { service, orders, cache } = buildPersistenceService();
      orders.findConfirmedOrderId.mockResolvedValue('stored-order');
      cache.confirmReservation.mockRejectedValue(new Error('redis down'));

      const outcome = service.compensateFailedOrder(REF);

      await expect(outcome).rejects.toThrow('redis down');
    });
  });

  describe('scheduleCompensation', () => {
    it('enqueues a compensation job under a colon-free id derived from the orderId', async () => {
      const { service, queue } = buildPersistenceService();
      queue.add.mockResolvedValue({});

      await service.scheduleCompensation(REF);

      expect(queue.add).toHaveBeenCalledWith(ORDER_COMPENSATION_JOB_NAME, REF, {
        ...ORDER_COMPENSATION_JOB_OPTIONS,
        jobId: `compensate-${REF.orderId}`,
      });
    });

    it('rejects when the enqueue rejects', async () => {
      const { service, queue } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.scheduleCompensation(REF)).rejects.toThrow('redis down');
    });
  });
});
