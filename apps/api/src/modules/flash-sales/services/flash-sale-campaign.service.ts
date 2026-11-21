import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../common/providers/clock.service';
import {
  ACTIVE_FLASH_SALE_ID,
  DEFAULT_CAMPAIGN_DURATION_MS,
  DEFAULT_CAMPAIGN_TOTAL_STOCK,
} from '../constants/flash-sales.constants';
import { flashSaleNotFound } from '../errors/flash-sale-not-found.error';
import type {
  FlashSaleCampaign,
  RescheduleCampaignParams,
} from '../interfaces/flash-sale.interface';
import { FlashSalesRepository } from '../repositories/flash-sales.repository';

/**
 * Lifecycle of the `flash_sales` row (seed, reschedule). Kept apart from FlashSalesService, which
 * owns the hot status read path and its 200 ms micro-cache.
 */
@Injectable()
export class FlashSaleCampaignService {
  constructor(
    private readonly flashSalesRepository: FlashSalesRepository,
    private readonly clock: ClockService,
  ) {}

  /** Returns the stored row, so an existing campaign comes back unchanged. */
  async ensureActiveCampaign(productId: string): Promise<FlashSaleCampaign> {
    const startsAtMs = this.clock.nowMs();
    await this.flashSalesRepository.insertIfAbsent({
      id: ACTIVE_FLASH_SALE_ID,
      productId,
      totalStock: DEFAULT_CAMPAIGN_TOTAL_STOCK,
      remainingStock: DEFAULT_CAMPAIGN_TOTAL_STOCK,
      startsAt: new Date(startsAtMs),
      endsAt: new Date(startsAtMs + DEFAULT_CAMPAIGN_DURATION_MS),
    });
    const campaign = await this.flashSalesRepository.findById(ACTIVE_FLASH_SALE_ID);
    return campaign ?? this.throwNotFound();
  }

  /** Rewrites window and stock. NotFoundException(FLASH_SALE_NOT_FOUND) when the row is missing. */
  async rescheduleCampaign(params: RescheduleCampaignParams): Promise<FlashSaleCampaign> {
    const campaign = await this.flashSalesRepository.reschedule(params);
    return campaign ?? this.throwNotFound();
  }

  private throwNotFound(): never {
    throw flashSaleNotFound();
  }
}
