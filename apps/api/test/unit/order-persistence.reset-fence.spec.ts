import { ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES } from '../../src/common/constants/common.constants';
import type { ClockService } from '../../src/common/providers/clock.service';
import {
  RESET_ACTIVE_JOBS_POLL_MS,
  RESET_ACTIVE_JOBS_TIMEOUT_MS,
} from '../../src/modules/orders/constants/orders.constants';
import { buildPersistenceService } from '../support/order-persistence.mocks';

describe('OrderPersistenceService reset fence', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('discardSaleOrders', () => {
    it('pauses the queue, drains waiting and delayed jobs, then deletes the sale rows', async () => {
      const { service, calls, queue, orders } = buildPersistenceService();

      await service.discardSaleOrders('sale-1');

      expect(calls).toEqual(['pause', 'drain', 'deleteBySale']);
      expect(queue.drain).toHaveBeenCalledWith(true);
      expect(orders.deleteBySale).toHaveBeenCalledWith('sale-1');
    });

    it('never resumes the queue itself: the caller does once the new sale state is written', async () => {
      const { service, queue } = buildPersistenceService();

      await service.discardSaleOrders('sale-1');

      expect(queue.resume).not.toHaveBeenCalled();
    });

    it('waits for in-flight jobs to finish before draining', async () => {
      jest.useFakeTimers();
      const { service, queue } = buildPersistenceService();
      queue.getActiveCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValue(0);

      const discard = service.discardSaleOrders('sale-1');
      await jest.advanceTimersByTimeAsync(RESET_ACTIVE_JOBS_POLL_MS);
      expect(queue.drain).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(RESET_ACTIVE_JOBS_POLL_MS);
      await discard;

      expect(queue.getActiveCount).toHaveBeenCalledTimes(3);
      expect(queue.drain).toHaveBeenCalledTimes(1);
    });

    it('answers 503 TEMPORARY_FAILURE without draining or deleting when jobs stay active', async () => {
      jest.useFakeTimers();
      const { service, queue, orders } = buildPersistenceService();
      queue.getActiveCount.mockResolvedValue(1);

      const discard = service.discardSaleOrders('sale-1');
      const settled = discard.then(
        () => undefined,
        (error: unknown) => error,
      );
      await jest.advanceTimersByTimeAsync(RESET_ACTIVE_JOBS_TIMEOUT_MS);
      const error = await settled;

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        code: ERROR_CODES.TEMPORARY_FAILURE,
      });
      expect(queue.drain).not.toHaveBeenCalled();
      expect(orders.deleteBySale).not.toHaveBeenCalled();
    });

    it('counts the time a slow getActiveCount takes toward the timeout, using the injected clock', async () => {
      let nowMs = 1_000;
      const clock = { nowMs: () => nowMs } as unknown as ClockService;
      const { service, queue, orders } = buildPersistenceService(clock);
      queue.getActiveCount.mockImplementation(async () => {
        nowMs += RESET_ACTIVE_JOBS_TIMEOUT_MS;
        return 1;
      });

      const discard = service.discardSaleOrders('sale-1');

      await expect(discard).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(queue.getActiveCount).toHaveBeenCalledTimes(1);
      expect(orders.deleteBySale).not.toHaveBeenCalled();
    });

    it('still waits just before the timeout', async () => {
      jest.useFakeTimers();
      const { service, queue } = buildPersistenceService();
      queue.getActiveCount.mockResolvedValue(1);
      let isSettled = false;

      void service
        .discardSaleOrders('sale-1')
        .catch(() => undefined)
        .finally(() => {
          isSettled = true;
        });
      await jest.advanceTimersByTimeAsync(RESET_ACTIVE_JOBS_TIMEOUT_MS - RESET_ACTIVE_JOBS_POLL_MS);

      expect(isSettled).toBe(false);
      await jest.advanceTimersByTimeAsync(RESET_ACTIVE_JOBS_POLL_MS);
      expect(isSettled).toBe(true);
    });
  });

  describe('resumeProcessing', () => {
    it('resumes the queue', async () => {
      const { service, queue } = buildPersistenceService();

      await service.resumeProcessing();

      expect(queue.resume).toHaveBeenCalledTimes(1);
    });
  });
});
