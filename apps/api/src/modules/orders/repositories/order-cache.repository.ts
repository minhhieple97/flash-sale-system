import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import {
  FLASH_SALE_CONFIG_FIELDS as FIELDS,
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  REDIS_CLIENT,
  RESERVATION_ENTRY_PREFIX,
  ROLLBACK_PURCHASE_REPLY,
} from '../../../infrastructure/redis/redis.constants';
import type { FlashSaleRedis } from '../../../infrastructure/redis/redis.interfaces';
import { RESERVATION_SCAN_COUNT } from '../constants/orders.constants';
import type {
  ConfirmedReservation,
  LedgerHydrationResult,
  ReleaseOutcome,
  ReservationRef,
  ReservationSlot,
  SaleLedgerState,
} from '../interfaces/order.interface';

type EntryStatus = keyof typeof RESERVATION_ENTRY_PREFIX;
const ENTRY_STATUSES: readonly EntryStatus[] = ['RESERVED', 'CONFIRMED'];

function encodeEntry(status: EntryStatus, orderId: string): string {
  return `${RESERVATION_ENTRY_PREFIX[status]}${orderId}`;
}

function parseEntry(raw: string | null): ReservationSlot {
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
function collectReserved(fieldsAndValues: readonly string[], into: Map<string, string>): void {
  for (let index = 0; index < fieldsAndValues.length; index += 2) {
    const slot = parseEntry(fieldsAndValues[index + 1]);
    if (slot.status === 'RESERVED') into.set(fieldsAndValues[index], slot.orderId);
  }
}

function toConfirmedEntries(confirmed: readonly ConfirmedReservation[]): Record<string, string> {
  return Object.fromEntries(
    confirmed.map(({ userId, orderId }) => [userId, encodeEntry('CONFIRMED', orderId)]),
  );
}

function toConfigFields(state: SaleLedgerState): Record<string, string> {
  const { snapshot } = state;
  return {
    [FIELDS.saleId]: snapshot.saleId,
    [FIELDS.productId]: snapshot.productId,
    [FIELDS.productName]: snapshot.productName,
    [FIELDS.salePriceCents]: String(snapshot.salePriceCents),
    [FIELDS.originalPriceCents]: String(snapshot.originalPriceCents),
    [FIELDS.totalStock]: String(snapshot.totalStock),
    [FIELDS.startTimeMs]: String(snapshot.startsAtMs),
    [FIELDS.endTimeMs]: String(snapshot.endsAtMs),
  };
}

/**
 * Sole TypeScript owner of the `users` hash wire format (`RESERVED:<orderId>`,
 * `CONFIRMED:<orderId>`) and of whole-sale state writes. Encode/parse helpers stay private to
 * this file; callers only ever see ReservationSlot and the outcome unions.
 */
@Injectable()
export class OrderCacheRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: FlashSaleRedis) {}

  /** A value with an unknown prefix throws. */
  async findSlot(saleId: string, userId: NormalizedUserId): Promise<ReservationSlot> {
    return parseEntry(await this.redis.hget(flashSaleUsersKey(saleId), userId));
  }

  /** The RESERVED entries of a sale, as refs. CONFIRMED entries are skipped. */
  async listReservations(saleId: string): Promise<ReservationRef[]> {
    const reserved = new Map<string, string>();
    let cursor = '0';
    do {
      const [next, fieldsAndValues] = await this.redis.hscan(
        flashSaleUsersKey(saleId),
        cursor,
        'COUNT',
        RESERVATION_SCAN_COUNT,
      );
      collectReserved(fieldsAndValues, reserved);
      cursor = next;
    } while (cursor !== '0');
    return [...reserved].map(([userId, orderId]) => ({
      saleId,
      userId: userId as NormalizedUserId,
      orderId,
    }));
  }

  /** Idempotent. */
  async markConfirmed(ref: ReservationRef): Promise<void> {
    await this.redis.hset(
      flashSaleUsersKey(ref.saleId),
      ref.userId,
      encodeEntry('CONFIRMED', ref.orderId),
    );
  }

  /** rollbackPurchase Lua: HDEL + INCR stock only while the entry is `RESERVED:<ref.orderId>`. */
  async releaseReservation(ref: ReservationRef): Promise<ReleaseOutcome> {
    const reply = await this.redis.rollbackPurchase(
      flashSaleStockKey(ref.saleId),
      flashSaleUsersKey(ref.saleId),
      ref.userId,
      ref.orderId,
    );
    if (reply === ROLLBACK_PURCHASE_REPLY.RELEASED) return 'RELEASED';
    if (reply === ROLLBACK_PURCHASE_REPLY.NOT_RESERVED) return 'NOT_RESERVED';
    throw new Error(`Unexpected rollbackPurchase reply: ${String(reply)}`);
  }

  /**
   * Check and write are not atomic across instances. Acceptable because hydration runs once per
   * boot, before the HTTP listener opens, and compose runs a single API instance.
   */
  async hydrateIfAbsent(state: SaleLedgerState): Promise<LedgerHydrationResult> {
    const exists = await this.redis.exists(flashSaleConfigKey(state.snapshot.saleId));
    if (exists === 1) return 'ALREADY_PRESENT';
    await this.replaceState(state);
    return 'HYDRATED';
  }

  /** Overwrites the whole sale state in one MULTI. */
  async replaceState(state: SaleLedgerState): Promise<void> {
    const { saleId, remainingStock } = state.snapshot;
    const usersKey = flashSaleUsersKey(saleId);
    const configKey = flashSaleConfigKey(saleId);
    const transaction = this.redis
      .multi()
      .del(usersKey, configKey)
      .hset(configKey, toConfigFields(state))
      .set(flashSaleStockKey(saleId), String(remainingStock));
    // HSET with no fields is a Redis error.
    if (state.confirmed.length > 0) transaction.hset(usersKey, toConfirmedEntries(state.confirmed));
    const results = await transaction.exec();
    const failure = results?.find(([error]) => error !== null)?.[0];
    if (failure) throw failure;
  }
}
