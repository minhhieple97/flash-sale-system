import { Injectable, NotFoundException } from '@nestjs/common';
import { ClockService } from '../../../common/providers/clock.service';
import {
  ACTIVE_FLASH_SALE_ID,
  FLASH_SALE_ERROR_CODES,
  FLASH_SALE_NOT_FOUND_MESSAGE,
  FLASH_SALE_STATUS_CACHE_TTL_MS,
} from '../constants/flash-sales.constants';
import type {
  FlashSaleCacheEntry,
  FlashSaleSnapshot,
  FlashSaleStatus,
} from '../interfaces/flash-sale.interface';
import { FlashSaleCacheRepository } from '../repositories/flash-sale-cache.repository';
import { computeSaleState } from '../utils/sale-state.util';

@Injectable()
export class FlashSalesService {
  private entry: FlashSaleCacheEntry | null = null;

  constructor(
    private readonly cache: FlashSaleCacheRepository,
    private readonly clock: ClockService,
  ) {}

  async getCurrentStatus(): Promise<FlashSaleStatus> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot) {
      throw new NotFoundException({
        code: FLASH_SALE_ERROR_CODES.FLASH_SALE_NOT_FOUND,
        message: FLASH_SALE_NOT_FOUND_MESSAGE,
      });
    }
    const serverTimeMs = this.clock.nowMs();
    return { ...snapshot, saleState: computeSaleState(snapshot, serverTimeMs), serverTimeMs };
  }

  invalidateCache(): void {
    this.entry = null;
  }

  private loadSnapshot(): Promise<FlashSaleSnapshot | null> {
    const nowMs = this.clock.nowMs();
    if (this.entry && nowMs < this.entry.expiresAtMs) return this.entry.snapshot;
    const entry: FlashSaleCacheEntry = {
      snapshot: this.cache.readSnapshot(ACTIVE_FLASH_SALE_ID),
      expiresAtMs: nowMs + FLASH_SALE_STATUS_CACHE_TTL_MS,
    };
    this.entry = entry;
    entry.snapshot.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return entry.snapshot;
  }
}
