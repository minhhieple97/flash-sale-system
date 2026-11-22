import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Worker } from 'bullmq';
import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_PERSISTENCE_JOB_NAME,
} from '../../src/modules/orders/constants/orders.constants';
import { OrderPersistenceRejectedError } from '../../src/modules/orders/errors/order-persistence-rejected.error';
import type { PersistOrderResult } from '../../src/modules/orders/interfaces/order.interface';
import { buildProcessor, jobOf, PROCESSOR_REF as REF } from '../support/order-processor.mocks';

const RETRYABLE = new Error('connection terminated');

describe('OrderPersistenceProcessor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('process', () => {
    it('persists a persist-order job and returns the result', async () => {
      const { processor, persistReservedOrder, compensateFailedOrder } = buildProcessor();
      const result: PersistOrderResult = { outcome: 'INSERTED', orderId: REF.orderId };
      persistReservedOrder.mockResolvedValue(result);

      const processed = await processor.process(jobOf({ name: ORDER_PERSISTENCE_JOB_NAME }));

      expect(processed).toBe(result);
      expect(persistReservedOrder).toHaveBeenCalledWith(REF);
      expect(compensateFailedOrder).not.toHaveBeenCalled();
    });

    it('compensates a compensate-order job and returns the outcome', async () => {
      const { processor, persistReservedOrder, compensateFailedOrder } = buildProcessor();
      compensateFailedOrder.mockResolvedValue('CONFIRMED');

      const processed = await processor.process(jobOf({ name: ORDER_COMPENSATION_JOB_NAME }));

      expect(processed).toBe('CONFIRMED');
      expect(compensateFailedOrder).toHaveBeenCalledWith(REF);
      expect(persistReservedOrder).not.toHaveBeenCalled();
    });

    it('rethrows OrderPersistenceRejectedError from process as UnrecoverableError', async () => {
      const { processor, persistReservedOrder } = buildProcessor();
      persistReservedOrder.mockRejectedValue(
        new OrderPersistenceRejectedError('SALE_NOT_FOUND', REF.orderId),
      );

      const processed = processor.process(jobOf());

      await expect(processed).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(processed).rejects.toThrow('SALE_NOT_FOUND');
    });

    it('rejects a job with an unknown name and touches nothing', async () => {
      const { processor, persistReservedOrder, compensateFailedOrder } = buildProcessor();

      const processed = processor.process(jobOf({ name: 'mystery' }));

      await expect(processed).rejects.toThrow('mystery');
      expect(persistReservedOrder).not.toHaveBeenCalled();
      expect(compensateFailedOrder).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('does nothing while attempts remain', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(jobOf({ attemptsMade: 4, attempts: 5 }), RETRYABLE);

      expect(scheduleCompensation).not.toHaveBeenCalled();
    });

    it('schedules compensation once the final persist attempt failed, without compensating inline', async () => {
      const { processor, scheduleCompensation, compensateFailedOrder } = buildProcessor();

      await processor.onFailed(jobOf({ attemptsMade: 5, attempts: 5 }), RETRYABLE);

      expect(scheduleCompensation).toHaveBeenCalledTimes(1);
      expect(scheduleCompensation).toHaveBeenCalledWith(REF);
      expect(compensateFailedOrder).not.toHaveBeenCalled();
    });

    it('treats a job without opts.attempts as a single attempt', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(jobOf({ attemptsMade: 1 }), RETRYABLE);

      expect(scheduleCompensation).toHaveBeenCalledWith(REF);
    });

    it('compensates when the job failed with UnrecoverableError on attempt 1', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(
        jobOf({ attemptsMade: 1, attempts: 150 }),
        new UnrecoverableError('SALE_NOT_FOUND'),
      );

      expect(scheduleCompensation).toHaveBeenCalledTimes(1);
    });

    it('does not compensate an ECONNREFUSED failure on attempt 1', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

      await processor.onFailed(jobOf({ attemptsMade: 1, attempts: 150 }), refused);

      expect(scheduleCompensation).not.toHaveBeenCalled();
    });

    it('compensates a job BullMQ failed as stalled more than the allowable limit', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(
        jobOf({ attemptsMade: 1, attempts: 150 }),
        new UnrecoverableError('job stalled more than allowable limit'),
      );

      expect(scheduleCompensation).toHaveBeenCalledTimes(1);
    });

    it('ignores an undefined job', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(undefined, RETRYABLE);

      expect(scheduleCompensation).not.toHaveBeenCalled();
    });

    it('never rejects and logs the orderId at error when scheduling the compensation fails', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      scheduleCompensation.mockRejectedValue(new Error('redis down'));
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const outcome = processor.onFailed(jobOf({ attemptsMade: 5, attempts: 5 }), RETRYABLE);

      await expect(outcome).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(REF.orderId);
      expect(String(error.mock.calls[0][0])).toContain('redis down');
    });

    it('logs at error that the maintenance sweep takes over when the final compensation attempt failed', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await processor.onFailed(
        jobOf({ name: ORDER_COMPENSATION_JOB_NAME, attemptsMade: 8, attempts: 8 }),
        RETRYABLE,
      );

      expect(scheduleCompensation).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(REF.orderId);
      expect(String(error.mock.calls[0][0])).toContain('the ledger maintenance sweep retries it');
    });

    it('does nothing for a compensation job while attempts remain', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await processor.onFailed(
        jobOf({ name: ORDER_COMPENSATION_JOB_NAME, attemptsMade: 3, attempts: 8 }),
        RETRYABLE,
      );

      expect(scheduleCompensation).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('onError', () => {
    it('logs a worker error at error instead of leaving it unhandled', () => {
      const { processor } = buildProcessor();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      processor.onError(new Error('Missing key for job order-1'));

      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain('Missing key for job order-1');
    });
  });

  describe('onModuleDestroy', () => {
    it('waits for the worker to close', async () => {
      const { processor } = buildProcessor();
      const close = jest.fn<Promise<void>, []>();
      close.mockResolvedValue(undefined);
      Object.defineProperty(processor, 'worker', { value: { close } as unknown as Worker });

      await processor.onModuleDestroy();

      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
