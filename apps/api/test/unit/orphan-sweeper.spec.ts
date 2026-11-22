import { Logger } from '@nestjs/common';
import type { JobState } from 'bullmq';
import { OrphanSweeper } from '../../src/modules/orders/services/orphan-sweeper.service';
import type { ReservationRef, SaleLedgerRepository } from '../../src/modules/sale-ledger';
import {
  buildPersistenceService,
  type PersistenceServiceMocks,
  PERSISTENCE_REF as REF,
} from '../support/order-persistence.mocks';
import { userIdOf } from '../support/user-id.fixtures';

const COMPENSATION_JOB_ID = `compensate-${REF.orderId}`;
const NONE_COMPENSATED = { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 };

interface SweeperMocks extends PersistenceServiceMocks {
  sweeper: OrphanSweeper;
}

function buildSweeper(refs: ReservationRef[] = [REF]): SweeperMocks {
  const mocks = buildPersistenceService();
  mocks.cache.listReservations.mockResolvedValue(refs);
  const sweeper = new OrphanSweeper(mocks.service, mocks.cache as unknown as SaleLedgerRepository);
  return { ...mocks, sweeper };
}

function withJobStates(
  mocks: PersistenceServiceMocks,
  states: Record<string, JobState | 'unknown'>,
): void {
  mocks.queue.getJobState.mockImplementation(async (jobId) => states[jobId] ?? 'unknown');
}

describe('OrphanSweeper', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('releases a RESERVED entry with no job at the boot threshold and counts it as RELEASED', async () => {
    const mocks = buildSweeper();

    const summary = await mocks.sweeper.sweepOrphans(REF.saleId, 'BOOT');

    expect(mocks.cache.listReservations).toHaveBeenCalledWith(REF.saleId);
    expect(mocks.cache.releaseReservation).toHaveBeenCalledWith(REF);
    expect(summary).toEqual({
      pending: 0,
      candidates: 0,
      compensated: { ...NONE_COMPENSATED, RELEASED: 1 },
    });
  });

  it('leaves a jobless entry untouched on the first interval sweep and releases it on the second', async () => {
    const mocks = buildSweeper();

    const first = await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');
    const releasesAfterFirst = mocks.cache.releaseReservation.mock.calls.length;
    const second = await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');

    expect(first).toEqual({ pending: 0, candidates: 1, compensated: NONE_COMPENSATED });
    expect(releasesAfterFirst).toBe(0);
    expect(second.compensated.RELEASED).toBe(1);
    expect(mocks.cache.releaseReservation).toHaveBeenCalledWith(REF);
  });

  it('keeps an entry whose persistence job appears between two interval sweeps', async () => {
    const mocks = buildSweeper();

    await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');
    withJobStates(mocks, { [REF.orderId]: 'waiting' });
    const second = await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');
    withJobStates(mocks, {});
    const third = await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');

    expect(second).toEqual({ pending: 1, candidates: 0, compensated: NONE_COMPENSATED });
    expect(third).toEqual({ pending: 0, candidates: 1, compensated: NONE_COMPENSATED });
    expect(mocks.cache.releaseReservation).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'] as const)(
    'counts an entry as pending while its persistence job is %s',
    async (state) => {
      const mocks = buildSweeper();
      withJobStates(mocks, { [REF.orderId]: state });

      const summary = await mocks.sweeper.sweepOrphans(REF.saleId, 'BOOT');

      expect(summary).toEqual({ pending: 1, candidates: 0, compensated: NONE_COMPENSATED });
      expect(mocks.orders.findConfirmedOrderId).not.toHaveBeenCalled();
    },
  );

  it('counts an entry as pending while its compensation job waits after the persistence job failed', async () => {
    const mocks = buildSweeper();
    withJobStates(mocks, { [REF.orderId]: 'failed', [COMPENSATION_JOB_ID]: 'delayed' });

    const summary = await mocks.sweeper.sweepOrphans(REF.saleId, 'BOOT');

    expect(summary.pending).toBe(1);
    expect(mocks.cache.releaseReservation).not.toHaveBeenCalled();
  });

  it.each([
    ['the persistence job failed and no compensation job exists', { [REF.orderId]: 'failed' }],
    ['both jobs failed', { [REF.orderId]: 'failed', [COMPENSATION_JOB_ID]: 'failed' }],
  ] as const)('compensates an entry when %s', async (_case, states) => {
    const mocks = buildSweeper();
    withJobStates(mocks, states);

    const summary = await mocks.sweeper.sweepOrphans(REF.saleId, 'BOOT');

    expect(mocks.orders.findConfirmedOrderId).toHaveBeenCalledWith(REF.saleId, REF.userId);
    expect(summary.compensated.RELEASED).toBe(1);
  });

  it('confirms instead of releasing an orphan whose order PostgreSQL already holds', async () => {
    const mocks = buildSweeper();
    mocks.orders.findConfirmedOrderId.mockResolvedValue(REF.orderId);

    const summary = await mocks.sweeper.sweepOrphans(REF.saleId, 'BOOT');

    expect(mocks.cache.confirmReservation).toHaveBeenCalledWith(REF, REF.orderId);
    expect(mocks.cache.releaseReservation).not.toHaveBeenCalled();
    expect(summary.compensated).toEqual({ ...NONE_COMPENSATED, CONFIRMED: 1 });
  });

  it('counts each entry once across a mix of pending and orphaned reservations', async () => {
    const bob = { ...REF, userId: userIdOf('bob'), orderId: 'order-bob' };
    const carol = { ...REF, userId: userIdOf('carol'), orderId: 'order-carol' };
    const mocks = buildSweeper([REF, bob, carol]);
    withJobStates(mocks, { [bob.orderId]: 'waiting' });
    mocks.cache.releaseReservation
      .mockResolvedValueOnce('RELEASED')
      .mockResolvedValueOnce('NOT_RESERVED');

    const summary = await mocks.sweeper.sweepOrphans(REF.saleId, 'BOOT');

    expect(summary).toEqual({
      pending: 1,
      candidates: 0,
      compensated: { CONFIRMED: 0, RELEASED: 1, NOT_RESERVED: 1 },
    });
  });

  it('logs one warn with the summary when it compensated anything, and nothing otherwise', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mocks = buildSweeper();

    await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');
    const warnsAfterFirst = warn.mock.calls.length;
    await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');

    expect(warnsAfterFirst).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/RELEASED.*1/);
  });

  it('rejects when compensation cannot reach PostgreSQL and keeps the previous strikes', async () => {
    const mocks = buildSweeper();
    await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');
    mocks.orders.findConfirmedOrderId.mockRejectedValueOnce(new Error('db down'));

    const failed = mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');
    await expect(failed).rejects.toThrow('db down');
    const retried = await mocks.sweeper.sweepOrphans(REF.saleId, 'INTERVAL');

    expect(retried.compensated.RELEASED).toBe(1);
  });
});
