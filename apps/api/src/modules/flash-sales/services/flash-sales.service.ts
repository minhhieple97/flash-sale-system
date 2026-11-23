import { Injectable, Logger, Optional } from '@nestjs/common';
import { temporaryFailure } from '../../../common/errors/temporary-failure.error';
import { ClockService } from '../../../common/providers/clock.service';
import { isDatabaseUnavailable } from '../../../infrastructure/database/database-fault.util';
import { SaleLedgerRepository, type SnapshotRead } from '../../sale-ledger';
import {
  ACTIVE_FLASH_SALE_ID,
  FLASH_SALE_STATUS_CACHE_TTL_MS,
  STOCK_MISSING_WARNING,
} from '../constants/flash-sales.constants';
import { flashSaleNotFound } from '../errors/flash-sale-not-found.error';
import type {
  FlashSaleCacheEntry,
  FlashSaleCampaign,
  FlashSaleStatus,
} from '../interfaces/flash-sale.interface';
import { FlashSalesRepository } from '../repositories/flash-sales.repository';
import { computeSaleState } from '../utils/sale-state.util';

@Injectable()
export class FlashSalesService {
  private readonly logger = new Logger(FlashSalesService.name);
  private entry: FlashSaleCacheEntry | null = null;

  constructor(
    private readonly ledger: SaleLedgerRepository,
    private readonly clock: ClockService,
    @Optional() private readonly flashSalesRepository?: FlashSalesRepository,
  ) {}

  async getCurrentStatus(): Promise<FlashSaleStatus> {
    const read = await this.loadSnapshot();
    if (read.status === 'STOCK_MISSING') return this.failWhileStateIsLost();
    if (read.status === 'NOT_CONFIGURED') return this.handleNotConfigured();
    const { snapshot } = read;
    const serverTimeMs = this.clock.nowMs();
    return { ...snapshot, saleState: computeSaleState(snapshot, serverTimeMs), serverTimeMs };
  }

  private async handleNotConfigured(): Promise<never> {
    if (!this.flashSalesRepository) throw flashSaleNotFound();
    const campaign = await this.findActiveCampaign(this.flashSalesRepository);
    if (campaign !== null) return this.failWhileStateIsLost();
    throw flashSaleNotFound();
  }

  private async findActiveCampaign(
    repository: FlashSalesRepository,
  ): Promise<FlashSaleCampaign | null> {
    try {
      return await repository.findById(ACTIVE_FLASH_SALE_ID);
    } catch (error: unknown) {
      if (isDatabaseUnavailable(error)) return this.failWhileStateIsLost();
      throw error;
    }
  }

  private failWhileStateIsLost(): never {
    this.logger.warn(STOCK_MISSING_WARNING);
    throw temporaryFailure();
  }

  invalidateCache(): void {
    this.entry = null;
  }

  private loadSnapshot(): Promise<SnapshotRead> {
    const nowMs = this.clock.nowMs();
    if (this.entry && nowMs < this.entry.expiresAtMs) return this.entry.snapshot;
    const entry: FlashSaleCacheEntry = {
      snapshot: this.ledger.readSnapshot(ACTIVE_FLASH_SALE_ID),
      expiresAtMs: nowMs + FLASH_SALE_STATUS_CACHE_TTL_MS,
    };
    this.entry = entry;
    entry.snapshot.then(
      (read) => {
        if (read.status !== 'FOUND' && this.entry === entry) this.entry = null;
      },
      () => {
        if (this.entry === entry) this.entry = null;
      },
    );
    return entry.snapshot;
  }
}
