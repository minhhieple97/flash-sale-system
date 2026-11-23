import { Injectable, Logger } from '@nestjs/common';
import { ClockService } from '../../../common/providers/clock.service';
import { type ReservationRef, SaleLedgerRepository } from '../../sale-ledger';
import { ORPHAN_GRACE_MS } from '../constants/orders.constants';
import type { CompensationOutcome, OrphanSweepSummary } from '../interfaces/order.interface';
import { OrderPersistenceService } from './order-persistence.service';

@Injectable()
export class OrphanSweeper {
  private readonly logger = new Logger(OrphanSweeper.name);

  constructor(
    private readonly persistence: OrderPersistenceService,
    private readonly ledger: SaleLedgerRepository,
    private readonly clock: ClockService = new ClockService(),
  ) {}

  async sweepOrphans(saleId: string, graceMs = ORPHAN_GRACE_MS): Promise<OrphanSweepSummary> {
    const cutoffMs = graceMs <= 0 ? undefined : this.clock.nowMs() - graceMs;
    const candidates = await this.ledger.listPendingReservations(saleId, cutoffMs);
    const { pending, orphans } = await this.partitionOrphans(candidates);
    const compensated = await this.compensate(orphans);
    const summary: OrphanSweepSummary = { pending, compensated };
    if (orphans.length > 0) {
      this.logger.warn(`Swept orphaned reservations of sale ${saleId}: ${JSON.stringify(summary)}`);
    }
    return summary;
  }

  private async partitionOrphans(
    candidates: readonly ReservationRef[],
  ): Promise<{ pending: number; orphans: ReservationRef[] }> {
    let pending = 0;
    const orphans: ReservationRef[] = [];
    for (const ref of candidates) {
      if (await this.persistence.hasPendingJob(ref)) pending += 1;
      else orphans.push(ref);
    }
    return { pending, orphans };
  }

  private async compensate(
    refs: readonly ReservationRef[],
  ): Promise<Record<CompensationOutcome, number>> {
    const compensated = { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 };
    for (const ref of refs) compensated[await this.persistence.compensateFailedOrder(ref)] += 1;
    return compensated;
  }
}
