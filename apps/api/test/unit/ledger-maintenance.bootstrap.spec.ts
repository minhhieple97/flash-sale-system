import { Logger } from '@nestjs/common';
import {
  BOOT_LEASE_MAX_ATTEMPTS,
  BOOT_LEASE_RETRY_MS,
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

const SWEEP: OrphanSweepSummary = {
  pending: 0,
  compensated: { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 },
};

function buildBootstrapService(intervalMs: MaintenanceIntervalMs = MAINTENANCE_DISABLED) {
  const hydrate = jest.fn(async (): Promise<LedgerHydrationResult> => 'ALREADY_PRESENT');
  const sweepOrphans = jest.fn(
    async (_saleId: string, _graceMs?: number): Promise<OrphanSweepSummary> => SWEEP,
  );
  const acquireMaintenanceLease = jest.fn<Promise<boolean>, [MaintenanceLease]>(async () => true);
  const releaseMaintenanceLease = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const resumeProcessing = jest.fn<Promise<void>, []>(async () => undefined);
  const service = new LedgerMaintenanceService(
    { hydrate, restoreIfLost: jest.fn() } as unknown as FlashSaleHydrationService,
    { sweepOrphans } as unknown as OrphanSweeper,
    { invalidateCache: jest.fn() } as unknown as FlashSalesService,
    { resumeProcessing } as unknown as FlashSaleResetService,
    intervalMs,
    { acquireMaintenanceLease, releaseMaintenanceLease } as unknown as SaleLedgerLeaseRepository,
  );
  return {
    service,
    hydrate,
    sweepOrphans,
    resumeProcessing,
    acquireMaintenanceLease,
    releaseMaintenanceLease,
  };
}

describe('LedgerMaintenanceService bootstrap coordination', () => {
  let service: LedgerMaintenanceService | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    service = null;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hydrates, resumes processing, and runs the boot sweep (graceMs = 0) under the Redis lease', async () => {
    const built = buildBootstrapService(5_000);
    service = built.service;

    await built.service.onApplicationBootstrap();

    expect(built.acquireMaintenanceLease).toHaveBeenCalledTimes(1);
    expect(built.hydrate).toHaveBeenCalledTimes(1);
    expect(built.resumeProcessing).toHaveBeenCalledTimes(1);
    expect(built.sweepOrphans).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, 0);
    expect(built.releaseMaintenanceLease).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('retries acquiring the Redis lease during bootstrap before hydrating', async () => {
    const built = buildBootstrapService();
    service = built.service;
    built.acquireMaintenanceLease
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const boot = built.service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BOOT_LEASE_RETRY_MS * 2);
    await boot;

    expect(built.acquireMaintenanceLease).toHaveBeenCalledTimes(3);
    expect(built.acquireMaintenanceLease).toHaveBeenLastCalledWith({
      saleId: ACTIVE_FLASH_SALE_ID,
      ownerToken: expect.any(String),
      ttlMs: MAINTENANCE_LEASE_TTL_MS,
    });
    expect(built.hydrate).toHaveBeenCalledTimes(1);
    const { ownerToken } = built.acquireMaintenanceLease.mock.calls[2][0];
    expect(built.releaseMaintenanceLease).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID, ownerToken);
  });

  it('warns and skips bootstrap hydration when another instance holds the lease past max attempts', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const built = buildBootstrapService(5_000);
    service = built.service;
    built.acquireMaintenanceLease.mockResolvedValue(false);

    const boot = built.service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BOOT_LEASE_RETRY_MS * BOOT_LEASE_MAX_ATTEMPTS);
    await boot;

    expect(built.acquireMaintenanceLease).toHaveBeenCalledTimes(BOOT_LEASE_MAX_ATTEMPTS);
    expect(built.hydrate).not.toHaveBeenCalled();
    expect(built.resumeProcessing).not.toHaveBeenCalled();
    expect(built.sweepOrphans).not.toHaveBeenCalled();
    expect(built.releaseMaintenanceLease).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('releases the lease even when hydrate throws on bootstrap', async () => {
    const built = buildBootstrapService();
    service = built.service;
    built.hydrate.mockRejectedValueOnce(new Error('db down'));

    await expect(built.service.onApplicationBootstrap()).rejects.toThrow('db down');
    expect(built.resumeProcessing).not.toHaveBeenCalled();
    expect(built.releaseMaintenanceLease).toHaveBeenCalledTimes(1);
  });
});
