import { Injectable, Logger } from '@nestjs/common';
import { type ReservationRef, SaleLedgerRepository } from '../../sale-ledger';
import { NO_STRIKES, STRIKES_TO_COMPENSATE } from '../constants/orders.constants';
import type {
  CompensationOutcome,
  OrphanStrikes,
  OrphanSweepSummary,
  SweepTrigger,
} from '../interfaces/order.interface';
import { decideSweep } from '../utils/orphan-sweep.util';
import { OrderPersistenceService } from './order-persistence.service';

@Injectable()
export class OrphanSweeper {
  private readonly logger = new Logger(OrphanSweeper.name);
  private strikes: OrphanStrikes = NO_STRIKES;

  constructor(
    private readonly persistence: OrderPersistenceService,
    private readonly ledger: SaleLedgerRepository,
  ) {}

  async sweepOrphans(saleId: string, trigger: SweepTrigger): Promise<OrphanSweepSummary> {
    const reservations = await this.ledger.listReservations(saleId);
    const orphans = await this.findOrphans(reservations);
    const decision = decideSweep(this.strikes, orphans, STRIKES_TO_COMPENSATE[trigger]);
    const compensated = await this.compensate(decision.toCompensate);
    this.strikes = decision.nextStrikes;
    const summary: OrphanSweepSummary = {
      pending: reservations.length - orphans.length,
      candidates: decision.nextStrikes.size,
      compensated,
    };
    if (decision.toCompensate.length > 0) {
      this.logger.warn(`Swept orphaned reservations of sale ${saleId}: ${JSON.stringify(summary)}`);
    }
    return summary;
  }

  private async findOrphans(reservations: readonly ReservationRef[]): Promise<ReservationRef[]> {
    const orphans: ReservationRef[] = [];
    for (const ref of reservations) {
      if (!(await this.persistence.hasPendingJob(ref))) orphans.push(ref);
    }
    return orphans;
  }

  private async compensate(
    refs: readonly ReservationRef[],
  ): Promise<Record<CompensationOutcome, number>> {
    const compensated = { CONFIRMED: 0, RELEASED: 0, NOT_RESERVED: 0 };
    for (const ref of refs) compensated[await this.persistence.compensateFailedOrder(ref)] += 1;
    return compensated;
  }
}
