import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type { FlashSaleStatus } from '../../flash-sales/interfaces/flash-sale.interface';
import { FlashSaleCampaignService } from '../../flash-sales/services/flash-sale-campaign.service';
import { FlashSalesService } from '../../flash-sales/services/flash-sales.service';
import { OrderPersistenceService } from '../../orders/services/order-persistence.service';
import { OrdersService } from '../../orders/services/orders.service';
import { ProductsService } from '../../products/services/products.service';
import type { ResetFlashSaleInput, ResetFlashSalePlan } from '../interfaces/admin.interface';
import { resolveResetPlan } from '../utils/reset-plan.util';
import { buildSaleSnapshot } from '../utils/sale-snapshot.util';

/** Demo/test tool. Not linearizable with concurrent purchases; callers reset before traffic. */
@Injectable()
export class FlashSaleResetService {
  /** Settles when the latest reset settles; never rejects, so a failed reset does not block the next. */
  private lastReset: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly products: ProductsService,
    private readonly campaigns: FlashSaleCampaignService,
    private readonly flashSales: FlashSalesService,
    private readonly orders: OrdersService,
    private readonly orderPersistence: OrderPersistenceService,
    private readonly clock: ClockService,
  ) {}

  /**
   * One reset at a time in this process: the queue pause is global, so an overlapping reset's resume
   * would let jobs of the old sale persist into the sale being rebuilt.
   */
  async reset(input: ResetFlashSaleInput): Promise<FlashSaleStatus> {
    const run = this.lastReset.then(() => this.runReset(input));
    this.lastReset = run.catch(() => undefined);
    return run;
  }

  /**
   * The discard pauses order processing and waits out in-flight jobs. Processing resumes only once
   * the new sale state is in Redis, so a late job meets the new state and ends STALE; the `finally`
   * resumes it even when a step fails.
   */
  private async runReset(input: ResetFlashSaleInput): Promise<FlashSaleStatus> {
    const plan = resolveResetPlan(input, this.clock.nowMs());
    try {
      await this.orderPersistence.discardSaleOrders(ACTIVE_FLASH_SALE_ID);
      await this.rebuildSale(plan);
    } finally {
      await this.orderPersistence.resumeProcessing();
    }
    return this.flashSales.getCurrentStatus();
  }

  /** Order matters: the ledger is replaced before the micro-cache is dropped, so the next read is fresh. */
  private async rebuildSale(plan: ResetFlashSalePlan): Promise<void> {
    const campaign = await this.campaigns.rescheduleCampaign({
      saleId: ACTIVE_FLASH_SALE_ID,
      totalStock: plan.totalStock,
      startsAtMs: plan.startsAtMs,
      endsAtMs: plan.endsAtMs,
    });
    const stored = await this.products.getFeaturedProduct();
    const product = { ...stored, name: plan.productName ?? stored.name };
    const snapshot = buildSaleSnapshot({ product, campaign, remainingStock: plan.totalStock });
    await this.orders.replaceSaleState({ snapshot, confirmed: [] });
    this.flashSales.invalidateCache();
  }
}
