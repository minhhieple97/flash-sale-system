import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES } from '../../src/common/constants/common.constants';
import {
  MAINTENANCE_LEASE_TTL_MS,
  RESET_LEASE_MAX_ATTEMPTS,
  RESET_LEASE_RETRY_MS,
} from '../../src/modules/admin/constants/admin.constants';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { buildService, NOW_MS, STATUS } from '../support/reset-service.fixture';

describe('FlashSaleResetService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('drains pending jobs, invalidates Redis, reschedules, replaces the ledger, drops the micro-cache, resumes the queue, then reads the status', async () => {
    const { service, calls } = buildService();

    await service.reset({});

    expect(calls).toEqual([
      'drainPendingJobs',
      'invalidateState',
      'rescheduleCampaign',
      'replaceState',
      'invalidateCache',
      'resumeProcessing',
      'getCurrentStatus',
    ]);
  });

  it('resumes the queue and rethrows when the drain times out waiting for active jobs', async () => {
    const { service, calls, drainPendingJobs, resumeProcessing } = buildService();
    drainPendingJobs.mockRejectedValue(new ServiceUnavailableException());

    const outcome = service.reset({});

    await expect(outcome).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(resumeProcessing).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['resumeProcessing']);
  });

  it('resumes the queue and rethrows when a later step throws', async () => {
    const { service, calls, replaceState, resumeProcessing } = buildService();
    replaceState.mockRejectedValue(new Error('redis down'));

    const outcome = service.reset({});

    await expect(outcome).rejects.toThrow('redis down');
    expect(resumeProcessing).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'drainPendingJobs',
      'invalidateState',
      'rescheduleCampaign',
      'resumeProcessing',
    ]);
  });

  it('reschedules the active sale', async () => {
    const { service, rescheduleCampaign } = buildService();

    await service.reset({ totalStock: 5, startsOffsetSeconds: -60, durationSeconds: 3600 });

    expect(rescheduleCampaign).toHaveBeenCalledWith({
      saleId: ACTIVE_FLASH_SALE_ID,
      totalStock: 5,
      startsAtMs: NOW_MS - 60_000,
      endsAtMs: NOW_MS + 3_540_000,
    });
  });

  it('replaces the ledger with no confirmed orders and remaining stock equal to total stock', async () => {
    const { service, replaceState } = buildService();

    await service.reset({ totalStock: 5 });

    const [state] = replaceState.mock.calls[0];
    expect(state.confirmed).toEqual([]);
    expect(state.snapshot.totalStock).toBe(5);
    expect(state.snapshot.remainingStock).toBe(5);
  });

  it('returns what getCurrentStatus returned', async () => {
    const { service } = buildService();

    const status = await service.reset({});

    expect(status).toBe(STATUS);
  });

  describe('distributed maintenance lease', () => {
    it('acquires and releases the Redis lease with the matching token even when reset fails', async () => {
      const { service, replaceState, acquireMaintenanceLease, releaseMaintenanceLease } =
        buildService();
      replaceState.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.reset({})).rejects.toThrow('redis down');

      expect(acquireMaintenanceLease).toHaveBeenCalledWith({
        saleId: ACTIVE_FLASH_SALE_ID,
        ownerToken: expect.any(String),
        ttlMs: MAINTENANCE_LEASE_TTL_MS,
      });
      const { ownerToken } = acquireMaintenanceLease.mock.calls[0][0];
      expect(releaseMaintenanceLease).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, ownerToken);
    });

    it('retries briefly if another process holds the lease, then resets once released', async () => {
      jest.useFakeTimers();
      const { service, acquireMaintenanceLease, drainPendingJobs } = buildService();
      acquireMaintenanceLease.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const reset = service.reset({});
      await jest.advanceTimersByTimeAsync(RESET_LEASE_RETRY_MS);

      await expect(reset).resolves.toBe(STATUS);
      expect(acquireMaintenanceLease).toHaveBeenCalledTimes(2);
      expect(drainPendingJobs).toHaveBeenCalledTimes(1);
    });

    it('throws 503 TEMPORARY_FAILURE without touching queue or DB when the lease remains held', async () => {
      jest.useFakeTimers();
      const {
        service,
        acquireMaintenanceLease,
        releaseMaintenanceLease,
        drainPendingJobs,
        invalidateState,
        rescheduleCampaign,
      } = buildService();
      acquireMaintenanceLease.mockResolvedValue(false);

      const reset = service.reset({}).then(
        () => undefined,
        (error: unknown) => error,
      );
      await jest.advanceTimersByTimeAsync(RESET_LEASE_RETRY_MS * RESET_LEASE_MAX_ATTEMPTS);
      const caught = await reset;

      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      expect((caught as ServiceUnavailableException).getResponse()).toMatchObject({
        code: ERROR_CODES.TEMPORARY_FAILURE,
      });
      expect(acquireMaintenanceLease).toHaveBeenCalledTimes(RESET_LEASE_MAX_ATTEMPTS);
      expect(drainPendingJobs).not.toHaveBeenCalled();
      expect(invalidateState).not.toHaveBeenCalled();
      expect(rescheduleCampaign).not.toHaveBeenCalled();
      expect(releaseMaintenanceLease).not.toHaveBeenCalled();
    });

    it('warns and preserves the original error when releasing the lease rejects', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service, replaceState, releaseMaintenanceLease } = buildService();
      replaceState.mockRejectedValueOnce(new Error('redis down'));
      releaseMaintenanceLease.mockRejectedValueOnce(new Error('release error'));

      await expect(service.reset({})).rejects.toThrow('redis down');
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
