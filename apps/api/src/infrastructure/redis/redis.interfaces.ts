import type Redis from 'ioredis';
import type { ATTEMPT_PURCHASE_REPLY, ROLLBACK_PURCHASE_REPLY } from './redis.constants';

export type AttemptPurchaseReply =
  (typeof ATTEMPT_PURCHASE_REPLY)[keyof typeof ATTEMPT_PURCHASE_REPLY];
export type RollbackPurchaseReply =
  (typeof ROLLBACK_PURCHASE_REPLY)[keyof typeof ROLLBACK_PURCHASE_REPLY];

/** KEYS[1..3] then ARGV[1..3], in the order ioredis forwards them to the script. */
export type AttemptPurchaseScriptArgs = [
  configKey: string,
  stockKey: string,
  usersKey: string,
  userId: string,
  nowMs: number,
  orderId: string,
];

/**
 * KEYS[1..2] then ARGV[1..2]. The script releases only while the entry still equals
 * `RESERVED:<orderId>`, so a repeat call, a CONFIRMED entry or a newer reservation stay untouched.
 */
export type RollbackPurchaseScriptArgs = [
  stockKey: string,
  usersKey: string,
  userId: string,
  orderId: string,
];

/**
 * Commands RedisModule registers with `defineCommand`. Replies are `unknown` on
 * purpose: the calling repository parses them into domain types at this boundary.
 */
export interface FlashSaleScriptCommands {
  attemptPurchase(...args: AttemptPurchaseScriptArgs): Promise<unknown>;
  rollbackPurchase(...args: RollbackPurchaseScriptArgs): Promise<unknown>;
}

/** What `REDIS_CLIENT` resolves to once RedisModule has registered the scripts. */
export type FlashSaleRedis = Redis & FlashSaleScriptCommands;

/** Shape of each `lua/*.lua.ts` export. `name` is tied to a FlashSaleScriptCommands method. */
export interface LuaScriptDefinition {
  readonly name: keyof FlashSaleScriptCommands;
  readonly numberOfKeys: number;
  readonly lua: string;
}
