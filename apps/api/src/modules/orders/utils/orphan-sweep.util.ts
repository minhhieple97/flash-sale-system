import type { ReservationRef } from '../../sale-ledger';
import type { OrphanStrikes, SweepDecision } from '../interfaces/order.interface';

export function decideSweep(
  previous: OrphanStrikes,
  orphans: readonly ReservationRef[],
  threshold: number,
): SweepDecision {
  const toCompensate: ReservationRef[] = [];
  const nextStrikes = new Map<string, number>();
  for (const ref of orphans) {
    const sightings = (previous.get(ref.orderId) ?? 0) + 1;
    if (sightings >= threshold) toCompensate.push(ref);
    else nextStrikes.set(ref.orderId, sightings);
  }
  return { toCompensate, nextStrikes };
}
