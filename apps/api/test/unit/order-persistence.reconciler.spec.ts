import { Logger } from '@nestjs/common';
import type { JobState } from 'bullmq';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import {
  buildPersistenceService,
  type PersistenceServiceMocks,
  PERSISTENCE_REF as REF,
} from '../support/order-persistence.mocks';
import { userIdOf } from '../support/user-id.fixtures';

const COMPENSATION_JOB_ID = `compensate-${REF.orderId}`;
const NO_ORPHANS = { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 };

function withJobStates(
  mocks: PersistenceServiceMocks,
  states: Record<string, JobState | 'unknown'>,
): void {
  mocks.queue.getJobState.mockImplementation(async (jobId) => states[jobId] ?? 'unknown');
}

function withReservations(mocks: PersistenceServiceMocks, refs: ReservationRef[]): void {
  mocks.cache.listReservations.mockResolvedValue(refs);
}

describe('OrderPersistenceService boot reconciliation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('reconcileOrphanedReservations', () => {
    it('releases a RESERVED entry that has no job and counts it as RELEASED', async () => {
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);

      const summary = await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(mocks.cache.listReservations).toHaveBeenCalledWith(REF.saleId);
      expect(mocks.cache.releaseReservation).toHaveBeenCalledWith(REF);
      expect(summary).toEqual({ pending: 0, orphans: { ...NO_ORPHANS, RELEASED: 1 } });
    });

    it.each(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'] as const)(
      'leaves an entry alone while its persistence job is %s',
      async (state) => {
        const mocks = buildPersistenceService();
        withReservations(mocks, [REF]);
        withJobStates(mocks, { [REF.orderId]: state });

        const summary = await mocks.service.reconcileOrphanedReservations(REF.saleId);

        expect(summary).toEqual({ pending: 1, orphans: NO_ORPHANS });
        expect(mocks.orders.findConfirmedOrderId).not.toHaveBeenCalled();
        expect(mocks.cache.releaseReservation).not.toHaveBeenCalled();
      },
    );

    it('leaves an entry alone while its compensation job is pending after the persistence job failed', async () => {
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);
      withJobStates(mocks, { [REF.orderId]: 'failed', [COMPENSATION_JOB_ID]: 'delayed' });

      const summary = await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(summary).toEqual({ pending: 1, orphans: NO_ORPHANS });
      expect(mocks.cache.releaseReservation).not.toHaveBeenCalled();
    });

    it.each([
      ['the persistence job failed and no compensation job exists', { [REF.orderId]: 'failed' }],
      ['both jobs failed', { [REF.orderId]: 'failed', [COMPENSATION_JOB_ID]: 'failed' }],
    ] as const)('compensates an entry when %s', async (_case, states) => {
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);
      withJobStates(mocks, states);

      const summary = await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(mocks.orders.findConfirmedOrderId).toHaveBeenCalledWith(REF.saleId, REF.userId);
      expect(summary.orphans.RELEASED).toBe(1);
    });

    it('confirms instead of releasing an orphan whose order PostgreSQL already holds', async () => {
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);
      mocks.orders.findConfirmedOrderId.mockResolvedValue(REF.orderId);

      const summary = await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(mocks.cache.markConfirmed).toHaveBeenCalledWith(REF);
      expect(mocks.cache.releaseReservation).not.toHaveBeenCalled();
      expect(summary).toEqual({ pending: 0, orphans: { ...NO_ORPHANS, CONFIRMED: 1 } });
    });

    it('counts each entry once across a mix of pending and orphaned reservations', async () => {
      const mocks = buildPersistenceService();
      const bob = { ...REF, userId: userIdOf('bob'), orderId: 'order-bob' };
      const carol = { ...REF, userId: userIdOf('carol'), orderId: 'order-carol' };
      withReservations(mocks, [REF, bob, carol]);
      withJobStates(mocks, { [bob.orderId]: 'waiting' });
      mocks.cache.releaseReservation
        .mockResolvedValueOnce('RELEASED')
        .mockResolvedValueOnce('NOT_RESERVED');

      const summary = await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(summary).toEqual({
        pending: 1,
        orphans: { CONFIRMED: 0, RELEASED: 1, NOT_RESERVED: 1 },
      });
    });

    it('logs one warn with the counts when orphans were found', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);

      await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/RELEASED.*1/);
    });

    it('logs nothing when every entry still has a pending job', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);
      withJobStates(mocks, { [REF.orderId]: 'waiting' });

      await mocks.service.reconcileOrphanedReservations(REF.saleId);

      expect(warn).not.toHaveBeenCalled();
    });

    it('rejects when compensation cannot reach PostgreSQL, so the boot fails loudly', async () => {
      const mocks = buildPersistenceService();
      withReservations(mocks, [REF]);
      mocks.orders.findConfirmedOrderId.mockRejectedValue(new Error('db down'));

      const outcome = mocks.service.reconcileOrphanedReservations(REF.saleId);

      await expect(outcome).rejects.toThrow('db down');
    });
  });

  describe('onApplicationBootstrap', () => {
    it('resumes the queue first, then reconciles the active sale', async () => {
      const mocks = buildPersistenceService();
      mocks.cache.listReservations.mockImplementation(async () => {
        mocks.calls.push('listReservations');
        return [];
      });

      await mocks.service.onApplicationBootstrap();

      expect(mocks.calls).toEqual(['resume', 'listReservations']);
      expect(mocks.cache.listReservations).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID);
    });
  });
});
