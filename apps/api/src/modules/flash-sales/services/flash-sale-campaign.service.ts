import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClockService } from '../../../common/providers/clock.service';
import type { AppEnv } from '../../../config/env.interface';
import { ACTIVE_FLASH_SALE_ID } from '../constants/flash-sales.constants';
import { flashSaleNotFound } from '../errors/flash-sale-not-found.error';
import type {
  ExplicitSaleConfig,
  FlashSaleCampaign,
  RescheduleCampaignParams,
  SaleWindowConfig,
} from '../interfaces/flash-sale.interface';
import { FlashSalesRepository } from '../repositories/flash-sales.repository';
import {
  parseExplicitSaleConfig,
  readSaleWindowEnv,
  resolveSaleWindow,
} from '../utils/sale-window.util';

/**
 * Lifecycle of the `flash_sales` row (seed, reschedule). Kept apart from FlashSalesService, which
 * owns the hot status read path and its 200 ms micro-cache.
 */
@Injectable()
export class FlashSaleCampaignService {
  constructor(
    private readonly flashSalesRepository: FlashSalesRepository,
    private readonly clock: ClockService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  configuredWindow(): SaleWindowConfig {
    return resolveSaleWindow(this.explicitConfig(), this.clock.nowMs());
  }

  explicitConfig(): ExplicitSaleConfig {
    return parseExplicitSaleConfig(readSaleWindowEnv(this.config));
  }

  /** Returns the stored row, so an existing campaign comes back unchanged. */
  async ensureActiveCampaign(
    productId: string,
    window: SaleWindowConfig,
  ): Promise<FlashSaleCampaign> {
    await this.flashSalesRepository.insertIfAbsent({
      id: ACTIVE_FLASH_SALE_ID,
      productId,
      totalStock: window.totalStock,
      remainingStock: window.totalStock,
      startsAt: new Date(window.startsAtMs),
      endsAt: new Date(window.endsAtMs),
    });
    const campaign = await this.flashSalesRepository.findById(ACTIVE_FLASH_SALE_ID);
    return campaign ?? this.throwNotFound();
  }

  async getActiveCampaign(): Promise<FlashSaleCampaign> {
    const campaign = await this.flashSalesRepository.findById(ACTIVE_FLASH_SALE_ID);
    return campaign ?? this.throwNotFound();
  }

  async rescheduleCampaign(params: RescheduleCampaignParams): Promise<FlashSaleCampaign> {
    const campaign = await this.flashSalesRepository.reschedule(params);
    return campaign ?? this.throwNotFound();
  }

  private throwNotFound(): never {
    throw flashSaleNotFound();
  }
}
