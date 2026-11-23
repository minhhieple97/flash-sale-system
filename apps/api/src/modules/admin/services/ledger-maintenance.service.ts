import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import { FlashSalesService } from '../../flash-sales/services/flash-sales.service';
import { OrphanSweeper } from '../../orders/services/orphan-sweeper.service';
import { SaleLedgerLeaseRepository } from '../../sale-ledger';
import {
  BOOT_LEASE_MAX_ATTEMPTS,
  BOOT_LEASE_RETRY_MS,
  LEDGER_MAINTENANCE_INTERVAL,
} from '../constants/admin.constants';
import type { MaintenanceIntervalMs, MaintenanceTickResult } from '../interfaces/admin.interface';
import { runWithMaintenanceLease } from '../utils/maintenance-lease.util';
import { FlashSaleHydrationService } from './flash-sale-hydration.service';
import { FlashSaleResetService } from './flash-sale-reset.service';

/** AdminModule is destroyed before OrdersModule closes the queue. */
@Injectable()
export class LedgerMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LedgerMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private activeRun: Promise<unknown> | null = null;

  constructor(
    private readonly hydration: FlashSaleHydrationService,
    private readonly sweeper: OrphanSweeper,
    private readonly flashSales: FlashSalesService,
    private readonly resets: FlashSaleResetService,
    @Inject(LEDGER_MAINTENANCE_INTERVAL) private readonly intervalMs: MaintenanceIntervalMs,
    private readonly leases: SaleLedgerLeaseRepository,
  ) {}

  /** Runs before the HTTP listener opens, so /health readiness also covers the boot heal. */
  async onApplicationBootstrap(): Promise<void> {
    await this.trackRun(() => this.runBootWithLease());
    if (this.intervalMs === null) return;
    this.timer = setInterval(() => this.runScheduledTick(), this.intervalMs).unref();
  }

  async tick(): Promise<MaintenanceTickResult> {
    if (this.activeRun !== null) return { status: 'SKIPPED_BUSY' };
    const attempt = await this.trackRun(() =>
      runWithMaintenanceLease({
        leases: this.leases,
        logger: this.logger,
        run: () => this.heal(),
      }),
    );
    if (!attempt.acquired) return { status: 'SKIPPED_BUSY' };
    return attempt.value;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.activeRun?.catch(() => undefined);
  }

  private trackRun<T>(run: () => Promise<T>): Promise<T> {
    const task = run();
    const settled = task
      .catch(() => undefined)
      .finally(() => {
        if (this.activeRun === settled) this.activeRun = null;
      });
    this.activeRun = settled;
    return task;
  }

  private async runBootWithLease(): Promise<void> {
    const attempt = await runWithMaintenanceLease({
      leases: this.leases,
      logger: this.logger,
      retry: { maxAttempts: BOOT_LEASE_MAX_ATTEMPTS, retryDelayMs: BOOT_LEASE_RETRY_MS },
      run: () => this.runBootSequence(),
    });
    if (!attempt.acquired) {
      this.logger.warn(
        `Skipped bootstrap hydration for sale ${ACTIVE_FLASH_SALE_ID}; maintenance lease remained busy`,
      );
    }
  }

  private async runBootSequence(): Promise<void> {
    await this.hydration.hydrate();
    await this.resets.resumeProcessing();
    await this.sweeper.sweepOrphans(ACTIVE_FLASH_SALE_ID, 0);
  }

  private async heal(): Promise<MaintenanceTickResult> {
    const hydration = await this.hydration.restoreIfLost();
    if (hydration === 'HYDRATED') {
      this.flashSales.invalidateCache();
      this.logger.warn(`Restored lost ledger state of sale ${ACTIVE_FLASH_SALE_ID}`);
    }
    await this.resets.resumeProcessing();
    const sweep = await this.sweeper.sweepOrphans(ACTIVE_FLASH_SALE_ID);
    return { status: 'RAN', hydration, sweep };
  }

  private runScheduledTick(): void {
    this.tick().catch((error: unknown) => {
      this.logger.error(`Ledger maintenance tick failed: ${String(error)}`);
    });
  }
}
