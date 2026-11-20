import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  ORDER_PERSISTENCE_JOB_NAME,
  ORDER_PERSISTENCE_JOB_OPTIONS,
} from '../../src/modules/orders/constants/orders.constants';
import type {
  PersistOrderResult,
  ReleaseOutcome,
  ReservationRef,
} from '../../src/modules/orders/interfaces/order.interface';
import type { OrderCacheRepository } from '../../src/modules/orders/repositories/order-cache.repository';
import type { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { userIdOf } from '../support/user-id.fixtures';

const REF: ReservationRef = {
  saleId: 'sale-1',
  userId: userIdOf('alice'),
  orderId: '6f1c1d52-9a3e-4a55-8f45-6a8a1e2b0c11',
};

function buildService() {
  const calls: string[] = [];
  const add = jest.fn<Promise<unknown>, unknown[]>();
  const getJob = jest.fn<Promise<unknown>, [string]>(async () => undefined);
  const obliterate = jest.fn<Promise<void>, unknown[]>(async () => {
    calls.push('obliterate');
  });
  const close = jest.fn<Promise<void>, []>();
  const persistConfirmedOrder = jest.fn<Promise<PersistOrderResult>, [ReservationRef]>(
    async (ref) => {
      calls.push('persistConfirmedOrder');
      return { outcome: 'INSERTED', orderId: ref.orderId };
    },
  );
  const deleteBySale = jest.fn<Promise<number>, [string]>(async () => {
    calls.push('deleteBySale');
    return 0;
  });
  const markConfirmed = jest.fn<Promise<void>, [ReservationRef]>(async () => {
    calls.push('markConfirmed');
  });
  const releaseReservation = jest.fn<Promise<ReleaseOutcome>, [ReservationRef]>();
  releaseReservation.mockResolvedValue('RELEASED');
  const service = new OrderPersistenceService(
    { add, getJob, obliterate, close } as unknown as Queue<ReservationRef>,
    { persistConfirmedOrder, deleteBySale } as unknown as OrdersRepository,
    { markConfirmed, releaseReservation } as unknown as OrderCacheRepository,
  );
  return {
    service,
    calls,
    add,
    getJob,
    obliterate,
    close,
    persistConfirmedOrder,
    deleteBySale,
    markConfirmed,
    releaseReservation,
  };
}

describe('OrderPersistenceService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('scheduleReservation', () => {
    it('enqueues the reservation under its orderId and reports QUEUED', async () => {
      const { service, add } = buildService();
      add.mockResolvedValue({});

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('QUEUED');
      expect(add).toHaveBeenCalledWith(ORDER_PERSISTENCE_JOB_NAME, REF, {
        ...ORDER_PERSISTENCE_JOB_OPTIONS,
        jobId: REF.orderId,
      });
    });

    it('uses a job id without a colon, which BullMQ rejects', async () => {
      const { service, add } = buildService();
      add.mockResolvedValue({});

      await service.scheduleReservation(REF);

      const options = add.mock.calls[0][2] as { jobId: string };
      expect(options.jobId).not.toContain(':');
    });

    it('releases the reservation exactly once and reports RELEASED when the enqueue rejects', async () => {
      const { service, add, releaseReservation } = buildService();
      add.mockRejectedValue(new Error('redis down'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('RELEASED');
      expect(releaseReservation).toHaveBeenCalledTimes(1);
      expect(releaseReservation).toHaveBeenCalledWith(REF);
    });

    it('keeps the reservation and reports QUEUED when the enqueue rejects but the job was stored', async () => {
      const { service, add, getJob, releaseReservation } = buildService();
      add.mockRejectedValue(new Error('reply lost'));
      getJob.mockResolvedValue({ id: REF.orderId });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('QUEUED');
      expect(getJob).toHaveBeenCalledWith(REF.orderId);
      expect(releaseReservation).not.toHaveBeenCalled();
    });

    it('rejects without releasing when the stored-job check also rejects', async () => {
      const { service, add, getJob, releaseReservation } = buildService();
      add.mockRejectedValue(new Error('redis down'));
      getJob.mockRejectedValue(new Error('still down'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = service.scheduleReservation(REF);

      await expect(outcome).rejects.toThrow('still down');
      expect(releaseReservation).not.toHaveBeenCalled();
    });

    it('logs the enqueue error once at warn with the orderId', async () => {
      const { service, add } = buildService();
      add.mockRejectedValue(new Error('redis down'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await service.scheduleReservation(REF);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(REF.orderId);
      expect(String(warn.mock.calls[0][0])).toContain('redis down');
    });

    it('rejects with the release error when the enqueue and the release both reject', async () => {
      const { service, add, releaseReservation } = buildService();
      add.mockRejectedValue(new Error('redis down'));
      releaseReservation.mockRejectedValue(new Error('release failed'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = service.scheduleReservation(REF);

      await expect(outcome).rejects.toThrow('release failed');
    });
  });

  describe('persistReservedOrder', () => {
    it('persists first, then marks the entry CONFIRMED with the stored order id', async () => {
      const { service, calls, persistConfirmedOrder, markConfirmed } = buildService();
      persistConfirmedOrder.mockImplementation(async () => {
        calls.push('persistConfirmedOrder');
        return { outcome: 'ALREADY_PERSISTED', orderId: 'stored-order' };
      });

      const result = await service.persistReservedOrder(REF);

      expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: 'stored-order' });
      expect(markConfirmed).toHaveBeenCalledWith({ ...REF, orderId: 'stored-order' });
      expect(calls).toEqual(['persistConfirmedOrder', 'markConfirmed']);
    });

    it('rejects and never marks CONFIRMED when the repository rejects', async () => {
      const { service, persistConfirmedOrder, markConfirmed } = buildService();
      persistConfirmedOrder.mockRejectedValue(new Error('db down'));

      const outcome = service.persistReservedOrder(REF);

      await expect(outcome).rejects.toThrow('db down');
      expect(markConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('compensateFailedOrder', () => {
    it('releases the reservation and reports RELEASED', async () => {
      const { service, releaseReservation } = buildService();

      const outcome = await service.compensateFailedOrder(REF);

      expect(outcome).toBe('RELEASED');
      expect(releaseReservation).toHaveBeenCalledWith(REF);
    });

    it('reports NOT_RESERVED on a repeated call', async () => {
      const { service, releaseReservation } = buildService();
      releaseReservation.mockResolvedValueOnce('RELEASED').mockResolvedValueOnce('NOT_RESERVED');

      await service.compensateFailedOrder(REF);
      const repeat = await service.compensateFailedOrder(REF);

      expect(repeat).toBe('NOT_RESERVED');
    });
  });

  describe('discardSaleOrders', () => {
    it('obliterates the queue with force before deleting the sale rows', async () => {
      const { service, calls, obliterate, deleteBySale } = buildService();

      await service.discardSaleOrders('sale-1');

      expect(obliterate).toHaveBeenCalledWith({ force: true });
      expect(deleteBySale).toHaveBeenCalledWith('sale-1');
      expect(calls).toEqual(['obliterate', 'deleteBySale']);
    });
  });

  describe('onModuleDestroy', () => {
    it('closes the queue so no producer outlives the module', async () => {
      const { service, close } = buildService();

      await service.onModuleDestroy();

      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
