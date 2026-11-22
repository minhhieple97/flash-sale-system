import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import {
  collectReserved,
  encodeConfirmedEntries,
  parseEntry,
} from '../codecs/reservation-entry.codec';
import { decodeSnapshot, encodeConfigFields } from '../codecs/sale-config.codec';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  HYDRATION_BATCH_SIZE,
  RESERVATION_SCAN_COUNT,
  SALE_LEDGER_REDIS,
} from '../constants/sale-ledger.constants';
import type {
  AdoptOutcome,
  AttemptPurchaseParams,
  ConfirmedReservation,
  ConfirmOutcome,
  LedgerHydrationResult,
  ReleaseOutcome,
  ReservationRef,
  ReservationSlot,
  ReservationVerdict,
  SaleLedgerState,
  SlotReadWithLedgerState,
  SnapshotRead,
} from '../interfaces/sale-ledger.interface';
import type { SaleLedgerRedis } from '../scripts/sale-ledger.scripts';
import { chunkArray } from '../utils/chunk.util';
import { unwrapTransaction } from '../utils/redis-transaction.util';
import { isVerdict, mapScriptReply, unexpectedReply } from '../utils/script-reply.util';

@Injectable()
export class SaleLedgerRepository {
  constructor(@Inject(SALE_LEDGER_REDIS) private readonly redis: SaleLedgerRedis) {}

  async reserve(params: AttemptPurchaseParams): Promise<ReservationVerdict> {
    const { saleId, userId, nowMs, orderId } = params;
    const reply = await this.redis.attemptPurchase(
      flashSaleConfigKey(saleId),
      flashSaleStockKey(saleId),
      flashSaleUsersKey(saleId),
      userId,
      nowMs,
      orderId,
    );
    if (!isVerdict(reply)) throw unexpectedReply('attemptPurchase', reply);
    return reply;
  }

  async releaseReservation(ref: ReservationRef): Promise<ReleaseOutcome> {
    const reply = await this.redis.rollbackPurchase(
      flashSaleStockKey(ref.saleId),
      flashSaleUsersKey(ref.saleId),
      ref.userId,
      ref.orderId,
    );
    return mapScriptReply('rollbackPurchase', reply);
  }

  async confirmReservation(ref: ReservationRef, confirmedOrderId: string): Promise<ConfirmOutcome> {
    const reply = await this.redis.confirmPurchase(
      flashSaleUsersKey(ref.saleId),
      ref.userId,
      ref.orderId,
      confirmedOrderId,
    );
    return mapScriptReply('confirmPurchase', reply);
  }

  async adoptCommittedOrder(order: ReservationRef): Promise<AdoptOutcome> {
    const reply = await this.redis.adoptOrder(
      flashSaleStockKey(order.saleId),
      flashSaleUsersKey(order.saleId),
      order.userId,
      order.orderId,
    );
    return mapScriptReply('adoptOrder', reply);
  }

  async findSlot(saleId: string, userId: NormalizedUserId): Promise<ReservationSlot> {
    return parseEntry(await this.redis.hget(flashSaleUsersKey(saleId), userId));
  }

  async readSlotWithLedgerState(
    saleId: string,
    userId: NormalizedUserId,
  ): Promise<SlotReadWithLedgerState> {
    const keys = [flashSaleConfigKey(saleId), flashSaleStockKey(saleId)];
    const result = await this.redis
      .multi()
      .hget(flashSaleUsersKey(saleId), userId)
      .exists(...keys)
      .exec();
    const [rawSlot, existingCount] = unwrapTransaction(result) as [string | null, number];
    return { slot: parseEntry(rawSlot), isLedgerIntact: existingCount === keys.length };
  }

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

  async countEntries(saleId: string): Promise<number> {
    return this.redis.hlen(flashSaleUsersKey(saleId));
  }

  async readSnapshot(saleId: string): Promise<SnapshotRead> {
    const result = await this.redis
      .multi()
      .hgetall(flashSaleConfigKey(saleId))
      .get(flashSaleStockKey(saleId))
      .exec();
    const [hash, stock] = unwrapTransaction(result) as [Record<string, string>, string | null];
    if (Object.keys(hash).length === 0) return { status: 'NOT_CONFIGURED' };
    if (stock === null) return { status: 'STOCK_MISSING' };
    return { status: 'FOUND', snapshot: decodeSnapshot(hash, stock) };
  }

  async isIntact(saleId: string): Promise<boolean> {
    const keys = [flashSaleConfigKey(saleId), flashSaleStockKey(saleId)];
    return (await this.redis.exists(...keys)) === keys.length;
  }

  async restoreConfirmedBatch(
    saleId: string,
    confirmed: readonly ConfirmedReservation[],
  ): Promise<boolean> {
    const usersKey = flashSaleUsersKey(saleId);
    let wroteAny = false;
    for (const chunk of chunkArray(confirmed, HYDRATION_BATCH_SIZE)) {
      const entryPairs = Object.entries(encodeConfirmedEntries(chunk)).flat();
      const reply = await this.redis.restoreConfirmedBatch(usersKey, ...entryPairs);
      if (mapScriptReply('restoreConfirmedBatch', reply) === 'WROTE') wroteAny = true;
    }
    return wroteAny;
  }

  async restoreLostState(state: SaleLedgerState): Promise<LedgerHydrationResult> {
    const { saleId, totalStock } = state.snapshot;
    const wroteBatch = await this.restoreConfirmedBatch(saleId, state.confirmed);
    const configPairs = Object.entries(encodeConfigFields(state.snapshot)).flat();
    const reply = await this.redis.restoreSale(
      flashSaleConfigKey(saleId),
      flashSaleStockKey(saleId),
      flashSaleUsersKey(saleId),
      totalStock,
      configPairs.length / 2,
      ...configPairs,
    );
    const outcome = mapScriptReply('restoreSale', reply);
    return wroteBatch ? 'HYDRATED' : outcome;
  }

  async replaceState(state: SaleLedgerState): Promise<void> {
    const { saleId, remainingStock } = state.snapshot;
    const usersKey = flashSaleUsersKey(saleId);
    const configKey = flashSaleConfigKey(saleId);
    const transaction = this.redis
      .multi()
      .del(usersKey, configKey)
      .hset(configKey, encodeConfigFields(state.snapshot))
      .set(flashSaleStockKey(saleId), String(remainingStock));
    for (const chunk of chunkArray(state.confirmed, HYDRATION_BATCH_SIZE)) {
      transaction.hset(usersKey, encodeConfirmedEntries(chunk));
    }
    unwrapTransaction(await transaction.exec());
  }

  async invalidateState(saleId: string): Promise<void> {
    await this.redis.del(
      flashSaleConfigKey(saleId),
      flashSaleStockKey(saleId),
      flashSaleUsersKey(saleId),
    );
  }
}
