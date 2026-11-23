import { Injectable, Logger } from '@nestjs/common';
import { temporaryFailure } from '../../../common/errors/temporary-failure.error';
import { ClockService } from '../../../common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type { FlashSaleStatus } from '../../flash-sales/interfaces/flash-sale.interface';
import { FlashSaleCampaignService } from '../../flash-sales/services/flash-sale-campaign.service';
import { FlashSalesService } from '../../flash-sales/services/flash-sales.service';
import { OrderPersistenceService } from '../../orders/services/order-persistence.service';
import { SaleLedgerLeaseRepository, SaleLedgerRepository } from '../../sale-ledger';
import { RESET_LEASE_MAX_ATTEMPTS, RESET_LEASE_RETRY_MS } from '../constants/admin.constants';
import type { ResetFlashSaleInput, ResetFlashSalePlan } from '../interfaces/admin.interface';
import { runWithMaintenanceLease } from '../utils/maintenance-lease.util';
import { resolveResetPlan } from '../utils/reset-plan.util';
import { buildSaleSnapshot } from '../utils/sale-snapshot.util';

/** Demo/test tool. Not linearizable with concurrent purchases; callers reset before traffic. */
@Injectable()
export class FlashSaleResetService {
  private readonly logger = new Logger(FlashSaleResetService.name);

  constructor(
    private readonly campaigns: FlashSaleCampaignService,
    private readonly flashSales: FlashSalesService,
    private readonly orderPersistence: OrderPersistenceService,
    private readonly ledger: SaleLedgerRepository,
    private readonly leases: SaleLedgerLeaseRepository,
    private readonly clock: ClockService,
  ) {}

  async reset(input: ResetFlashSaleInput): Promise<FlashSaleStatus> {
    const plan = resolveResetPlan(input, this.clock.nowMs(), this.campaigns.configuredWindow());
    const attempt = await runWithMaintenanceLease({
      leases: this.leases,
      logger: this.logger,
      retry: { maxAttempts: RESET_LEASE_MAX_ATTEMPTS, retryDelayMs: RESET_LEASE_RETRY_MS },
      run: () => this.runReset(plan),
    });
    if (!attempt.acquired) throw temporaryFailure();
    return this.flashSales.getCurrentStatus();
  }

  async resumeProcessing(): Promise<void> {
    await this.orderPersistence.resumeProcessing();
  }

  private async runReset(plan: ResetFlashSalePlan): Promise<void> {
    try {
      await this.orderPersistence.drainPendingJobs();
      await this.rebuildSale(plan);
    } finally {
      await this.orderPersistence.resumeProcessing();
    }
  }

  private async rebuildSale(plan: ResetFlashSalePlan): Promise<void> {
    await this.ledger.invalidateState(ACTIVE_FLASH_SALE_ID);
    const campaign = await this.campaigns.rescheduleCampaign({
      saleId: ACTIVE_FLASH_SALE_ID,
      totalStock: plan.totalStock,
      startsAtMs: plan.startsAtMs,
      endsAtMs: plan.endsAtMs,
    });
    await this.ledger.replaceState({
      snapshot: buildSaleSnapshot(campaign, plan.totalStock),
      confirmed: [],
    });
    this.flashSales.invalidateCache();
  }
}
