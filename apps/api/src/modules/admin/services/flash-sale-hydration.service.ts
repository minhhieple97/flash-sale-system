import { Injectable, Logger } from '@nestjs/common';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type {
  FlashSaleCampaign,
  SaleWindowConfig,
} from '../../flash-sales/interfaces/flash-sale.interface';
import { FlashSaleCampaignService } from '../../flash-sales/services/flash-sale-campaign.service';
import {
  applyExplicitSaleConfig,
  matchesSaleWindow,
} from '../../flash-sales/utils/sale-window.util';
import type { ConfirmedBatchCursor } from '../../orders/interfaces/order.interface';
import { OrdersService } from '../../orders/services/orders.service';
import { ProductsService } from '../../products/services/products.service';
import {
  HYDRATION_BATCH_SIZE,
  type LedgerHydrationResult,
  SaleLedgerRepository,
} from '../../sale-ledger';
import { buildSaleSnapshot } from '../utils/sale-snapshot.util';

@Injectable()
export class FlashSaleHydrationService {
  private readonly logger = new Logger(FlashSaleHydrationService.name);

  constructor(
    private readonly products: ProductsService,
    private readonly campaigns: FlashSaleCampaignService,
    private readonly orders: OrdersService,
    private readonly ledger: SaleLedgerRepository,
  ) {}

  async hydrate(): Promise<LedgerHydrationResult> {
    const product = await this.products.ensureFeaturedProduct();
    const seed = this.campaigns.configuredWindow();
    const stored = await this.campaigns.ensureActiveCampaign(product.id, seed);
    const target = applyExplicitSaleConfig(stored, this.campaigns.explicitConfig());
    if (await this.shouldReschedule(stored, target)) return this.reschedule(stored.id, target);
    return this.restoreFrom(stored);
  }

  async restoreIfLost(): Promise<LedgerHydrationResult> {
    if (await this.ledger.isIntact(ACTIVE_FLASH_SALE_ID)) return 'ALREADY_PRESENT';
    return this.restoreFrom(await this.campaigns.getActiveCampaign());
  }

  private async restoreFrom(campaign: FlashSaleCampaign): Promise<LedgerHydrationResult> {
    const { confirmedCount, wroteAnyBatch } = await this.restoreConfirmedInBatches(campaign.id);
    const snapshot = buildSaleSnapshot(campaign, campaign.totalStock - confirmedCount);
    const finalized = await this.ledger.restoreLostState({ snapshot, confirmed: [] });
    return wroteAnyBatch ? 'HYDRATED' : finalized;
  }

  private async restoreConfirmedInBatches(
    saleId: string,
  ): Promise<{ confirmedCount: number; wroteAnyBatch: boolean }> {
    let confirmedCount = 0;
    let wroteAnyBatch = false;
    let cursor: ConfirmedBatchCursor | undefined;
    do {
      const page = await this.orders.listConfirmedBatch({
        saleId,
        limit: HYDRATION_BATCH_SIZE,
        cursor,
      });
      confirmedCount += page.entries.length;
      if (
        page.entries.length > 0 &&
        (await this.ledger.restoreConfirmedBatch(saleId, page.entries))
      ) {
        wroteAnyBatch = true;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return { confirmedCount, wroteAnyBatch };
  }

  private async shouldReschedule(
    stored: FlashSaleCampaign,
    target: SaleWindowConfig,
  ): Promise<boolean> {
    if (matchesSaleWindow(stored, target)) return false;
    const hasOrders = await this.orders.hasConfirmedOrders(stored.id);
    const entries = await this.ledger.countEntries(stored.id);
    if (!hasOrders && entries === 0) return true;
    this.logger.warn(
      `SALE_* config differs from the stored sale ${stored.id}, which already has orders or reservations; keeping the stored window`,
    );
    return false;
  }

  private async reschedule(saleId: string, window: SaleWindowConfig): Promise<'HYDRATED'> {
    const campaign = await this.campaigns.rescheduleCampaign({ saleId, ...window });
    const snapshot = buildSaleSnapshot(campaign, window.totalStock);
    await this.ledger.replaceState({ snapshot, confirmed: [] });
    return 'HYDRATED';
  }
}
