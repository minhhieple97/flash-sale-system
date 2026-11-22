import { Injectable, Logger } from '@nestjs/common';
import { temporaryFailure } from '../../../common/errors/temporary-failure.error';
import { ClockService } from '../../../common/providers/clock.service';
import { SaleLedgerRepository, type SnapshotRead } from '../../sale-ledger';
import {
  ACTIVE_FLASH_SALE_ID,
  FLASH_SALE_STATUS_CACHE_TTL_MS,
  STOCK_MISSING_WARNING,
} from '../constants/flash-sales.constants';
import { flashSaleNotFound } from '../errors/flash-sale-not-found.error';
import type { FlashSaleCacheEntry, FlashSaleStatus } from '../interfaces/flash-sale.interface';
import { computeSaleState } from '../utils/sale-state.util';

@Injectable()
export class FlashSalesService {
  private readonly logger = new Logger(FlashSalesService.name);
  private entry: FlashSaleCacheEntry | null = null;

  constructor(
    private readonly ledger: SaleLedgerRepository,
    private readonly clock: ClockService,
  ) {}

  async getCurrentStatus(): Promise<FlashSaleStatus> {
    const read = await this.loadSnapshot();
    if (read.status === 'STOCK_MISSING') return this.failWhileStateIsLost();
    if (read.status === 'NOT_CONFIGURED') throw flashSaleNotFound();
    const { snapshot } = read;
    const serverTimeMs = this.clock.nowMs();
    return { ...snapshot, saleState: computeSaleState(snapshot, serverTimeMs), serverTimeMs };
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
    entry.snapshot.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return entry.snapshot;
  }
}
