import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../common/providers/clock.service';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type { FlashSaleStatus } from '../../flash-sales/interfaces/flash-sale.interface';
import { FlashSaleCampaignService } from '../../flash-sales/services/flash-sale-campaign.service';
import { FlashSalesService } from '../../flash-sales/services/flash-sales.service';
import { OrderPersistenceService } from '../../orders/services/order-persistence.service';
import { OrdersService } from '../../orders/services/orders.service';
import { ProductsService } from '../../products/services/products.service';
import type { ResetFlashSaleInput } from '../interfaces/admin.interface';
import { resolveResetPlan } from '../utils/reset-plan.util';
import { buildSaleSnapshot } from '../utils/sale-snapshot.util';

/** Demo/test tool. Not linearizable with concurrent purchases; callers reset before traffic. */
@Injectable()
export class FlashSaleResetService {
  constructor(
    private readonly products: ProductsService,
    private readonly campaigns: FlashSaleCampaignService,
    private readonly flashSales: FlashSalesService,
    private readonly orders: OrdersService,
    private readonly orderPersistence: OrderPersistenceService,
    private readonly clock: ClockService,
  ) {}

  /** Order matters: the ledger is replaced before the micro-cache is dropped, so the next read is fresh. */
  async reset(input: ResetFlashSaleInput): Promise<FlashSaleStatus> {
    const plan = resolveResetPlan(input, this.clock.nowMs());
    await this.orderPersistence.discardSaleOrders(ACTIVE_FLASH_SALE_ID);
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
    return this.flashSales.getCurrentStatus();
  }
}
