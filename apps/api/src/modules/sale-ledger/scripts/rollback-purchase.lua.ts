import {
  ROLLBACK_PURCHASE_REPLY as REPLY,
  RESERVATION_ENTRY_PREFIX,
  ROLLBACK_PURCHASE_KEY_COUNT,
} from '../constants/sale-ledger.constants';
import type { LuaScript } from './lua-script.interface';

type RollbackPurchaseArgs = [
  stockKey: string,
  usersKey: string,
  pendingKey: string,
  userId: string,
  orderId: string,
];

/** A missing stock key is lost state, not zero: INCR would recreate it as 1. */
const LUA = `
local held = redis.call('HGET', KEYS[2], ARGV[1])
if held ~= '${RESERVATION_ENTRY_PREFIX.RESERVED}' .. ARGV[2] then return ${REPLY.NOT_RESERVED} end

redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('INCR', KEYS[1]) end
return ${REPLY.RELEASED}
`;

export const ROLLBACK_PURCHASE_SCRIPT: LuaScript<'rollbackPurchase', RollbackPurchaseArgs> = {
  name: 'rollbackPurchase',
  numberOfKeys: ROLLBACK_PURCHASE_KEY_COUNT,
  lua: LUA,
};
