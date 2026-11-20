import { Inject, Injectable } from '@nestjs/common';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
  REDIS_CLIENT,
} from '../../../infrastructure/redis/redis.constants';
import type {
  AttemptPurchaseReply,
  FlashSaleRedis,
} from '../../../infrastructure/redis/redis.interfaces';
import type {
  ExecuteReservationParams,
  ReservationVerdict,
} from '../interfaces/checkout.interface';

/** Exhaustive by type: a new script reply without a verdict fails the build. */
const VERDICT_BY_REPLY: Readonly<Record<AttemptPurchaseReply, ReservationVerdict>> = {
  RESERVED: 'RESERVED',
  ALREADY_PURCHASED: 'ALREADY_PURCHASED',
  SOLD_OUT: 'SOLD_OUT',
  SALE_UPCOMING: 'SALE_UPCOMING',
  SALE_ENDED: 'SALE_ENDED',
  SALE_NOT_CONFIGURED: 'SALE_NOT_CONFIGURED',
};

// A Map keyed by unknown, so an unlisted reply (including 'constructor') misses cleanly.
const KNOWN_VERDICTS: ReadonlyMap<unknown, ReservationVerdict> = new Map(
  Object.entries(VERDICT_BY_REPLY),
);

/**
 * The atomic gate. Calls only `attemptPurchase`; it never reads or writes `users` values itself
 * (the Lua script builds the RESERVED entry), so the entry format stays out of this file.
 */
@Injectable()
export class CheckoutGatekeeperRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: FlashSaleRedis) {}

  /** The check order lives in attempt-purchase.lua.ts. An unknown reply throws. */
  async executeAtomicReservation(params: ExecuteReservationParams): Promise<ReservationVerdict> {
    const { saleId, userId, nowMs, orderId } = params;
    const reply = await this.redis.attemptPurchase(
      flashSaleConfigKey(saleId),
      flashSaleStockKey(saleId),
      flashSaleUsersKey(saleId),
      userId,
      nowMs,
      orderId,
    );
    return this.toVerdict(reply);
  }

  private toVerdict(reply: unknown): ReservationVerdict {
    const verdict = KNOWN_VERDICTS.get(reply);
    if (verdict === undefined)
      throw new Error(`Unexpected attemptPurchase reply: ${String(reply)}`);
    return verdict;
  }
}
