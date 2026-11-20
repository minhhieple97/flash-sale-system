import { Logger } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import {
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_PERSISTENCE_JOB_NAME,
} from '../../src/modules/orders/constants/orders.constants';
import type {
  CompensationOutcome,
  PersistOrderResult,
  ReservationRef,
} from '../../src/modules/orders/interfaces/order.interface';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import type { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { userIdOf } from '../support/user-id.fixtures';

const REF: ReservationRef = { saleId: 'sale-1', userId: userIdOf('alice'), orderId: 'order-1' };

interface JobShape {
  name?: string;
  attemptsMade?: number;
  attempts?: number;
}

function jobOf({
  name = ORDER_PERSISTENCE_JOB_NAME,
  attemptsMade = 0,
  attempts,
}: JobShape = {}): Job<ReservationRef> {
  return { name, data: REF, attemptsMade, opts: { attempts } } as unknown as Job<ReservationRef>;
}

function buildProcessor() {
  const persistReservedOrder = jest.fn<Promise<PersistOrderResult>, [ReservationRef]>();
  const compensateFailedOrder = jest.fn<Promise<CompensationOutcome>, [ReservationRef]>();
  const scheduleCompensation = jest.fn<Promise<void>, [ReservationRef]>(async () => undefined);
  const processor = new OrderPersistenceProcessor({
    persistReservedOrder,
    compensateFailedOrder,
    scheduleCompensation,
  } as unknown as OrderPersistenceService);
  return { processor, persistReservedOrder, compensateFailedOrder, scheduleCompensation };
}

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

      await processor.onFailed(jobOf({ attemptsMade: 4, attempts: 5 }));

      expect(scheduleCompensation).not.toHaveBeenCalled();
    });

    it('schedules compensation once the final persist attempt failed, without compensating inline', async () => {
      const { processor, scheduleCompensation, compensateFailedOrder } = buildProcessor();

      await processor.onFailed(jobOf({ attemptsMade: 5, attempts: 5 }));

      expect(scheduleCompensation).toHaveBeenCalledTimes(1);
      expect(scheduleCompensation).toHaveBeenCalledWith(REF);
      expect(compensateFailedOrder).not.toHaveBeenCalled();
    });

    it('treats a job without opts.attempts as a single attempt', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(jobOf({ attemptsMade: 1 }));

      expect(scheduleCompensation).toHaveBeenCalledWith(REF);
    });

    it('ignores an undefined job', async () => {
      const { processor, scheduleCompensation } = buildProcessor();

      await processor.onFailed(undefined);

      expect(scheduleCompensation).not.toHaveBeenCalled();
    });

    it('never rejects and logs the orderId at error when scheduling the compensation fails', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      scheduleCompensation.mockRejectedValue(new Error('redis down'));
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const outcome = processor.onFailed(jobOf({ attemptsMade: 5, attempts: 5 }));

      await expect(outcome).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(REF.orderId);
      expect(String(error.mock.calls[0][0])).toContain('redis down');
    });

    it('logs at error that the reservation stays held when the final compensation attempt failed', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await processor.onFailed(
        jobOf({ name: ORDER_COMPENSATION_JOB_NAME, attemptsMade: 8, attempts: 8 }),
      );

      expect(scheduleCompensation).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(REF.orderId);
      expect(String(error.mock.calls[0][0])).toContain('until a reset');
    });

    it('does nothing for a compensation job while attempts remain', async () => {
      const { processor, scheduleCompensation } = buildProcessor();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await processor.onFailed(
        jobOf({ name: ORDER_COMPENSATION_JOB_NAME, attemptsMade: 3, attempts: 8 }),
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
