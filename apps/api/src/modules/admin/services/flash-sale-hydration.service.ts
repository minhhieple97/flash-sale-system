import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { FlashSaleCampaignService } from '../../flash-sales/services/flash-sale-campaign.service';
import type { LedgerHydrationResult } from '../../orders/interfaces/order.interface';
import { OrdersService } from '../../orders/services/orders.service';
import { ProductsService } from '../../products/services/products.service';
import { buildSaleSnapshot } from '../utils/sale-snapshot.util';

/** Runs before the HTTP listener opens, so /health readiness also covers hydration. */
@Injectable()
export class FlashSaleHydrationService implements OnApplicationBootstrap {
  constructor(
    private readonly products: ProductsService,
    private readonly campaigns: FlashSaleCampaignService,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.hydrate();
  }

  /** ALREADY_PRESENT leaves live Redis state alone (warm restart, second instance). */
  async hydrate(): Promise<LedgerHydrationResult> {
    const product = await this.products.ensureFeaturedProduct();
    const campaign = await this.campaigns.ensureActiveCampaign(product.id);
    const confirmed = await this.orders.listConfirmedReservations(campaign.id);
    const snapshot = buildSaleSnapshot({
      product,
      campaign,
      remainingStock: campaign.totalStock - confirmed.length,
    });
    return this.orders.hydrateSaleState({ snapshot, confirmed });
  }
}
