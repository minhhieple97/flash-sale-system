import { RESERVATION_ENTRY_PREFIX } from '../constants/sale-ledger.constants';
import type { ConfirmedReservation, ReservationSlot } from '../interfaces/sale-ledger.interface';

type EntryStatus = keyof typeof RESERVATION_ENTRY_PREFIX;
const ENTRY_STATUSES: readonly EntryStatus[] = ['RESERVED', 'CONFIRMED'];

function encodeEntry(status: EntryStatus, orderId: string): string {
  return `${RESERVATION_ENTRY_PREFIX[status]}${orderId}`;
}

export function parseEntry(raw: string | null): ReservationSlot {
  if (raw === null) return { status: 'NONE' };
  for (const status of ENTRY_STATUSES) {
    const prefix = RESERVATION_ENTRY_PREFIX[status];
    if (!raw.startsWith(prefix)) continue;
    const orderId = raw.slice(prefix.length);
    if (orderId === '') throw new Error(`Corrupt reservation entry without an order id: ${raw}`);
    return { status, orderId };
  }
  throw new Error(`Corrupt reservation entry with an unknown prefix: ${raw}`);
}

/** HSCAN replies alternate field and value. HSCAN may repeat a field; the map keeps it once. */
export function collectReserved(
  fieldsAndValues: readonly string[],
  into: Map<string, string>,
): void {
  for (let index = 0; index < fieldsAndValues.length; index += 2) {
    const slot = parseEntry(fieldsAndValues[index + 1]);
    if (slot.status === 'RESERVED') into.set(fieldsAndValues[index], slot.orderId);
  }
}

export function encodeConfirmedEntries(
  confirmed: readonly ConfirmedReservation[],
): Record<string, string> {
  return Object.fromEntries(
    confirmed.map(({ userId, orderId }) => [userId, encodeEntry('CONFIRMED', orderId)]),
  );
}
