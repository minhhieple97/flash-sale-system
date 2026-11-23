import { Logger } from '@nestjs/common';
import {
  ORDER_PERSISTENCE_JOB_NAME,
  ORDER_PERSISTENCE_JOB_OPTIONS,
} from '../../src/modules/orders/constants/orders.constants';
import {
  buildPersistenceService,
  buildPersistenceWithMetrics,
  PERSISTENCE_REF as REF,
} from '../support/order-persistence.mocks';

describe('OrderPersistenceService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('scheduleReservation', () => {
    it('enqueues the reservation under its orderId and reports QUEUED', async () => {
      const { service, queue } = buildPersistenceService();
      queue.add.mockResolvedValue({});

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('QUEUED');
      expect(queue.add).toHaveBeenCalledWith(ORDER_PERSISTENCE_JOB_NAME, REF, {
        ...ORDER_PERSISTENCE_JOB_OPTIONS,
        jobId: REF.orderId,
      });
    });

    it('uses a job id without a colon, which BullMQ rejects', async () => {
      const { service, queue } = buildPersistenceService();
      queue.add.mockResolvedValue({});

      await service.scheduleReservation(REF);

      const options = queue.add.mock.calls[0][2] as { jobId: string };
      expect(options.jobId).not.toContain(':');
    });

    it('releases the reservation exactly once and reports RELEASED when the enqueue rejects', async () => {
      const { service, queue, cache } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('redis down'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('RELEASED');
      expect(cache.releaseReservation).toHaveBeenCalledTimes(1);
      expect(cache.releaseReservation).toHaveBeenCalledWith(REF);
    });

    it('keeps the reservation and reports QUEUED when the enqueue rejects but the job was stored', async () => {
      const { service, queue, cache } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('reply lost'));
      queue.getJob.mockResolvedValue({ id: REF.orderId });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('QUEUED');
      expect(queue.getJob).toHaveBeenCalledWith(REF.orderId);
      expect(cache.releaseReservation).not.toHaveBeenCalled();
    });

    it('releases and reports RELEASED when the stored-job check also rejects', async () => {
      const { service, queue, cache } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('redis down'));
      queue.getJob.mockRejectedValue(new Error('still down'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('RELEASED');
      expect(cache.releaseReservation).toHaveBeenCalledWith(REF);
    });

    it('logs the enqueue error once at warn with the orderId', async () => {
      const { service, queue } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('redis down'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await service.scheduleReservation(REF);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(REF.orderId);
      expect(String(warn.mock.calls[0][0])).toContain('redis down');
    });

    it('reports QUEUED when the job is gone and the release finds the slot already CONFIRMED', async () => {
      const { service, queue, cache } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('reply lost'));
      cache.releaseReservation.mockResolvedValue('NOT_RESERVED');
      cache.findSlot.mockResolvedValue({ status: 'CONFIRMED', orderId: REF.orderId });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('QUEUED');
      expect(cache.findSlot).toHaveBeenCalledWith(REF.saleId, REF.userId);
    });

    it('reports RELEASED when the release answers NOT_RESERVED and the slot is not CONFIRMED', async () => {
      const { service, queue, cache } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('redis down'));
      cache.releaseReservation.mockResolvedValue('NOT_RESERVED');
      cache.findSlot.mockResolvedValue({ status: 'NONE' });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = await service.scheduleReservation(REF);

      expect(outcome).toBe('RELEASED');
    });

    it('rejects with the release error when the enqueue and the release both reject', async () => {
      const { service, queue, cache } = buildPersistenceService();
      queue.add.mockRejectedValue(new Error('redis down'));
      cache.releaseReservation.mockRejectedValue(new Error('release failed'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const outcome = service.scheduleReservation(REF);

      await expect(outcome).rejects.toThrow('release failed');
    });

    it('preserves requestId in the queued job payload and tags enqueue-failure warnings', async () => {
      const { service, queue, cache } = buildPersistenceService();
      const jobData = { ...REF, requestId: 'req-sched-1' };
      queue.add.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('redis down'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await service.scheduleReservation(jobData);
      await service.scheduleReservation(jobData);

      expect(queue.add).toHaveBeenNthCalledWith(1, ORDER_PERSISTENCE_JOB_NAME, jobData, {
        ...ORDER_PERSISTENCE_JOB_OPTIONS,
        jobId: REF.orderId,
      });
      expect(cache.releaseReservation).toHaveBeenCalledWith(REF);
      expect(String(warn.mock.calls[0][0])).toContain('[req=req-sched-1]');
    });
  });

  describe('persistReservedOrder', () => {
    it('persists first, then marks the entry CONFIRMED with the stored order id', async () => {
      const { service, calls, orders, cache } = buildPersistenceService();
      orders.persistConfirmedOrder.mockImplementation(async () => {
        calls.push('persistConfirmedOrder');
        return { outcome: 'ALREADY_PERSISTED', orderId: 'stored-order' };
      });

      const result = await service.persistReservedOrder(REF);

      expect(result).toEqual({ outcome: 'ALREADY_PERSISTED', orderId: 'stored-order' });
      expect(cache.confirmReservation).toHaveBeenCalledWith(REF, 'stored-order');
      expect(calls).toEqual(['persistConfirmedOrder', 'confirmReservation']);
    });

    it('adopts the committed order with a stock unit when its entry is gone after the commit', async () => {
      const { service, cache } = buildPersistenceService();
      cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
      cache.adoptCommittedOrder.mockResolvedValue('ADOPTED');
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const result = await service.persistReservedOrder(REF);

      expect(result).toEqual({ outcome: 'INSERTED', orderId: REF.orderId });
      expect(cache.adoptCommittedOrder).toHaveBeenCalledWith(REF);
      expect(error).not.toHaveBeenCalled();
    });

    it('logs an error with the orderId and still returns the result when the commit cannot be adopted', async () => {
      const { service, cache } = buildPersistenceService();
      cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const result = await service.persistReservedOrder(REF);

      expect(result).toEqual({ outcome: 'INSERTED', orderId: REF.orderId });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(REF.orderId);
    });

    it('reads the slot of the job reservation before persisting', async () => {
      const { service, cache } = buildPersistenceService();

      await service.persistReservedOrder(REF);

      expect(cache.findSlot).toHaveBeenCalledWith(REF.saleId, REF.userId);
    });

    it('persists again when the slot is already CONFIRMED with the same orderId', async () => {
      const { service, orders, cache } = buildPersistenceService();
      cache.findSlot.mockResolvedValue({ status: 'CONFIRMED', orderId: REF.orderId });

      const result = await service.persistReservedOrder(REF);

      expect(result.outcome).toBe('INSERTED');
      expect(orders.persistConfirmedOrder).toHaveBeenCalledWith(REF);
    });

    it('reports STALE and touches neither store when the slot is empty', async () => {
      const { service, orders, cache } = buildPersistenceService();
      cache.findSlot.mockResolvedValue({ status: 'NONE' });

      const result = await service.persistReservedOrder(REF);

      expect(result).toEqual({ outcome: 'STALE', orderId: REF.orderId });
      expect(orders.persistConfirmedOrder).not.toHaveBeenCalled();
      expect(cache.confirmReservation).not.toHaveBeenCalled();
    });

    it('reports STALE and touches neither store when the slot holds another orderId', async () => {
      const { service, orders, cache } = buildPersistenceService();
      cache.findSlot.mockResolvedValue({ status: 'RESERVED', orderId: 'someone-else' });

      const result = await service.persistReservedOrder(REF);

      expect(result).toEqual({ outcome: 'STALE', orderId: REF.orderId });
      expect(orders.persistConfirmedOrder).not.toHaveBeenCalled();
      expect(cache.confirmReservation).not.toHaveBeenCalled();
    });

    it('rejects and never marks CONFIRMED when the repository rejects', async () => {
      const { service, orders, cache } = buildPersistenceService();
      orders.persistConfirmedOrder.mockRejectedValue(new Error('db down'));

      const outcome = service.persistReservedOrder(REF);

      await expect(outcome).rejects.toThrow('db down');
      expect(cache.confirmReservation).not.toHaveBeenCalled();
    });

    it('includes [req=...] in adoption warn and error logs when jobData carries requestId', async () => {
      const { service, cache } = buildPersistenceService();
      const jobData = { ...REF, requestId: 'req-persist-7' };
      cache.confirmReservation.mockResolvedValue('NOT_RESERVED');
      cache.adoptCommittedOrder
        .mockResolvedValueOnce('ADOPTED')
        .mockResolvedValueOnce('NOT_ADOPTED');
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await service.persistReservedOrder(jobData);
      await service.persistReservedOrder(jobData);

      expect(String(warn.mock.calls[0][0])).toContain('[req=req-persist-7]');
      expect(String(error.mock.calls[0][0])).toContain('[req=req-persist-7]');
    });
  });

  describe('lifecycle', () => {
    it('does not resume the queue on bootstrap so resume stays fenced under the maintenance lock', async () => {
      const { service, queue } = buildPersistenceService();

      await service.onApplicationBootstrap();

      expect(queue.resume).not.toHaveBeenCalled();
    });

    it('closes the queue so no producer outlives the module', async () => {
      const { service, queue } = buildPersistenceService();

      await service.onModuleDestroy();

      expect(queue.close).toHaveBeenCalledTimes(1);
    });

    it('records persistence and compensation metrics and registers queue collector', async () => {
      const c = buildPersistenceWithMetrics();
      await c.service.onApplicationBootstrap();
      await c.service.persistReservedOrder(REF);
      c.cache.findSlot.mockResolvedValueOnce({ status: 'NONE' });
      await c.service.persistReservedOrder(REF);
      c.orders.persistConfirmedOrder.mockRejectedValueOnce(new Error('db down'));
      await expect(c.service.persistReservedOrder(REF)).rejects.toThrow('db down');
      await c.service.compensateFailedOrder(REF);
      expect(await c.collectQueue()).toMatchObject({ waiting: 0 });
      expect(c.queue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'failed');
      expect(c.outcomes()).toEqual(['INSERTED', 'STALE', 'FAILED', 'RELEASED']);
    });
  });
});
