import {
  ROLLBACK_PURCHASE_REPLY as REPLY,
  RESERVATION_ENTRY_PREFIX,
  ROLLBACK_PURCHASE_KEY_COUNT,
} from '../redis.constants';
import type { LuaScriptDefinition } from '../redis.interfaces';

const LUA = `
local held = redis.call('HGET', KEYS[2], ARGV[1])
if held ~= '${RESERVATION_ENTRY_PREFIX.RESERVED}' .. ARGV[2] then return ${REPLY.NOT_RESERVED} end

redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('INCR', KEYS[1])
return ${REPLY.RELEASED}
`;

export const ROLLBACK_PURCHASE_SCRIPT: LuaScriptDefinition = {
  name: 'rollbackPurchase',
  numberOfKeys: ROLLBACK_PURCHASE_KEY_COUNT,
  lua: LUA,
};
