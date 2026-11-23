import { Logger } from '@nestjs/common';
import {
  MAINTENANCE_DISABLED,
  MAINTENANCE_LEASE_TTL_MS,
} from '../../src/modules/admin/constants/admin.constants';
import type { MaintenanceIntervalMs } from '../../src/modules/admin/interfaces/admin.interface';
import type { FlashSaleHydrationService } from '../../src/modules/admin/services/flash-sale-hydration.service';
import type { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import { LedgerMaintenanceService } from '../../src/modules/admin/services/ledger-maintenance.service';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type { OrphanSweepSummary } from '../../src/modules/orders/interfaces/order.interface';
import type { OrphanSweeper } from '../../src/modules/orders/services/orphan-sweeper.service';
import type {
  LedgerHydrationResult,
  MaintenanceLease,
  SaleLedgerLeaseRepository,
} from '../../src/modules/sale-ledger';
import { deferred } from '../support/deferred';

const INTERVAL_MS = 1_000;
const SWEEP: OrphanSweepSummary = {
  pending: 0,
  compensated: { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 },
};

function buildService(intervalMs: MaintenanceIntervalMs = INTERVAL_MS) {
  const calls: string[] = [];
  const recordAsync = <T>(name: string, value: T): jest.Mock<Promise<T>, []> =>
    jest.fn(async () => {
      calls.push(name);
      return value;
    });
  const hydrate = recordAsync<LedgerHydrationResult>('hydrate', 'ALREADY_PRESENT');
  const restoreIfLost = recordAsync<LedgerHydrationResult>('restoreIfLost', 'ALREADY_PRESENT');
  const sweepOrphans = jest.fn(async (saleId: string, graceMs?: number) => {
    const label = graceMs === 0 ? 'boot' : 'interval';
    calls.push(`sweep:${saleId === ACTIVE_FLASH_SALE_ID ? 'active' : saleId}:${label}`);
    return SWEEP;
  });
  const invalidateCache = jest.fn(() => {
    calls.push('invalidateCache');
  });
  const resumeProcessing = recordAsync<void>('resumeProcessing', undefined);
  const acquireMaintenanceLease = jest.fn<Promise<boolean>, [MaintenanceLease]>(async () => true);
  const releaseMaintenanceLease = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const service = new LedgerMaintenanceService(
    { hydrate, restoreIfLost } as unknown as FlashSaleHydrationService,
    { sweepOrphans } as unknown as OrphanSweeper,
    { invalidateCache } as unknown as FlashSalesService,
    { resumeProcessing } as unknown as FlashSaleResetService,
    intervalMs,
    { acquireMaintenanceLease, releaseMaintenanceLease } as unknown as SaleLedgerLeaseRepository,
  );
  return {
    service,
    calls,
    hydrate,
    restoreIfLost,
    sweepOrphans,
    invalidateCache,
    resumeProcessing,
    acquireMaintenanceLease,
    releaseMaintenanceLease,
  };
}

describe('LedgerMaintenanceService', () => {
  let built: ReturnType<typeof buildService> | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await built?.service.onModuleDestroy();
    built = null;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hydrates, resumes processing, and sweeps under the lease before starting the timer', async () => {
    built = buildService();

    await built.service.onApplicationBootstrap();

    expect(built.calls).toEqual(['hydrate', 'resumeProcessing', 'sweep:active:boot']);
    expect(built.acquireMaintenanceLease).toHaveBeenCalledTimes(1);
    expect(built.releaseMaintenanceLease).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('ticks once per interval and starts no timer when the interval is null', async () => {
    built = buildService();
    const disabled = buildService(MAINTENANCE_DISABLED);
    await built.service.onApplicationBootstrap();
    await disabled.service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(built.restoreIfLost).toHaveBeenCalledTimes(2);
    expect(built.sweepOrphans).toHaveBeenLastCalledWith(ACTIVE_FLASH_SALE_ID);
    expect(disabled.restoreIfLost).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('skips an overlapping tick while a previous tick is still running', async () => {
    built = buildService();
    const held = deferred();
    built.sweepOrphans.mockImplementationOnce(async () => {
      await held.promise;
      return SWEEP;
    });

    const first = built.service.tick();
    const second = await built.service.tick();
    held.resolve();
    await first;

    expect(second).toEqual({ status: 'SKIPPED_BUSY' });
    expect(built.restoreIfLost).toHaveBeenCalledTimes(1);
  });

  it('drops the status micro-cache only when the tick restored lost state', async () => {
    built = buildService();

    const intact = await built.service.tick();
    built.restoreIfLost.mockResolvedValueOnce('HYDRATED');
    const restored = await built.service.tick();

    expect(intact).toEqual({ status: 'RAN', hydration: 'ALREADY_PRESENT', sweep: SWEEP });
    expect(restored).toEqual({ status: 'RAN', hydration: 'HYDRATED', sweep: SWEEP });
    expect(built.invalidateCache).toHaveBeenCalledTimes(1);
    expect(built.resumeProcessing).toHaveBeenCalledTimes(2);
  });

  it('logs and keeps ticking after a tick rejects', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    built = buildService();
    await built.service.onApplicationBootstrap();
    built.sweepOrphans.mockRejectedValueOnce(new Error('pg down'));

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('pg down');
    expect(built.restoreIfLost).toHaveBeenCalledTimes(2);
  });

  it('clears the timer and waits for a running tick on module destroy', async () => {
    built = buildService();
    await built.service.onApplicationBootstrap();
    const held = deferred();
    built.sweepOrphans.mockImplementationOnce(async () => {
      await held.promise;
      return SWEEP;
    });
    const tick = built.service.tick();
    let destroyed = false;

    const destroy = built.service.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    const destroyedWhileTickRuns = destroyed;
    held.resolve();
    await Promise.all([tick, destroy]);

    expect(destroyedWhileTickRuns).toBe(false);
    expect(destroyed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(built.restoreIfLost).toHaveBeenCalledTimes(1);
  });

  it('skips a tick without running heal when another instance holds the Redis lease', async () => {
    built = buildService();
    built.acquireMaintenanceLease.mockResolvedValueOnce(false);

    const result = await built.service.tick();

    expect(result).toEqual({ status: 'SKIPPED_BUSY' });
    expect(built.resumeProcessing).not.toHaveBeenCalled();
    expect(built.releaseMaintenanceLease).not.toHaveBeenCalled();
  });

  it('releases the Redis lease with the matching token even when heal fails', async () => {
    built = buildService();
    built.sweepOrphans.mockRejectedValueOnce(new Error('pg down'));

    await expect(built.service.tick()).rejects.toThrow('pg down');

    expect(built.acquireMaintenanceLease).toHaveBeenCalledWith({
      saleId: ACTIVE_FLASH_SALE_ID,
      ownerToken: expect.any(String),
      ttlMs: MAINTENANCE_LEASE_TTL_MS,
    });
    const { ownerToken } = built.acquireMaintenanceLease.mock.calls[0][0];
    expect(built.releaseMaintenanceLease).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, ownerToken);
  });

  it('warns and preserves the original error if releasing the Redis lease rejects', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    built = buildService();
    built.sweepOrphans.mockRejectedValueOnce(new Error('pg down'));
    built.releaseMaintenanceLease.mockRejectedValueOnce(new Error('redis blip'));

    await expect(built.service.tick()).rejects.toThrow('pg down');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
