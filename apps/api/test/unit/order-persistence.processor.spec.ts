import { Logger } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import type {
  PersistOrderResult,
  ReleaseOutcome,
  ReservationRef,
} from '../../src/modules/orders/interfaces/order.interface';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import type { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { userIdOf } from '../support/user-id.fixtures';

const REF: ReservationRef = { saleId: 'sale-1', userId: userIdOf('alice'), orderId: 'order-1' };

function jobOf(attemptsMade: number, attempts?: number): Job<ReservationRef> {
  return { data: REF, attemptsMade, opts: { attempts } } as unknown as Job<ReservationRef>;
}

function buildProcessor() {
  const persistReservedOrder = jest.fn<Promise<PersistOrderResult>, [ReservationRef]>();
  const compensateFailedOrder = jest.fn<Promise<ReleaseOutcome>, [ReservationRef]>();
  compensateFailedOrder.mockResolvedValue('RELEASED');
  const processor = new OrderPersistenceProcessor({
    persistReservedOrder,
    compensateFailedOrder,
  } as unknown as OrderPersistenceService);
  return { processor, persistReservedOrder, compensateFailedOrder };
}

describe('OrderPersistenceProcessor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('process', () => {
    it('persists the job payload and returns the result', async () => {
      const { processor, persistReservedOrder } = buildProcessor();
      const result: PersistOrderResult = { outcome: 'INSERTED', orderId: REF.orderId };
      persistReservedOrder.mockResolvedValue(result);

      const processed = await processor.process(jobOf(0, 5));

      expect(processed).toBe(result);
      expect(persistReservedOrder).toHaveBeenCalledWith(REF);
    });
  });

  describe('onFailed', () => {
    it('does not compensate while attempts remain', async () => {
      const { processor, compensateFailedOrder } = buildProcessor();

      await processor.onFailed(jobOf(4, 5));

      expect(compensateFailedOrder).not.toHaveBeenCalled();
    });

    it('compensates once when the final attempt failed', async () => {
      const { processor, compensateFailedOrder } = buildProcessor();

      await processor.onFailed(jobOf(5, 5));

      expect(compensateFailedOrder).toHaveBeenCalledTimes(1);
      expect(compensateFailedOrder).toHaveBeenCalledWith(REF);
    });

    it('treats a job without opts.attempts as a single attempt', async () => {
      const { processor, compensateFailedOrder } = buildProcessor();

      await processor.onFailed(jobOf(1, undefined));

      expect(compensateFailedOrder).toHaveBeenCalledWith(REF);
    });

    it('ignores an undefined job', async () => {
      const { processor, compensateFailedOrder } = buildProcessor();

      await processor.onFailed(undefined);

      expect(compensateFailedOrder).not.toHaveBeenCalled();
    });

    it('never rejects and logs the orderId at error when the compensation fails', async () => {
      const { processor, compensateFailedOrder } = buildProcessor();
      compensateFailedOrder.mockRejectedValue(new Error('redis down'));
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const outcome = processor.onFailed(jobOf(5, 5));

      await expect(outcome).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(REF.orderId);
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
