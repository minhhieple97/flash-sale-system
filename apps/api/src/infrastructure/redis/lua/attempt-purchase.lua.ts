import {
  ATTEMPT_PURCHASE_KEY_COUNT,
  FLASH_SALE_CONFIG_FIELDS,
  ATTEMPT_PURCHASE_REPLY as REPLY,
  RESERVATION_ENTRY_PREFIX,
} from '../redis.constants';
import type { LuaScriptDefinition } from '../redis.interfaces';

const LUA = `
local startMs = tonumber(redis.call('HGET', KEYS[1], '${FLASH_SALE_CONFIG_FIELDS.startTimeMs}'))
local endMs = tonumber(redis.call('HGET', KEYS[1], '${FLASH_SALE_CONFIG_FIELDS.endTimeMs}'))
if not startMs or not endMs then return '${REPLY.SALE_NOT_CONFIGURED}' end

local nowMs = tonumber(ARGV[2])
if nowMs < startMs then return '${REPLY.SALE_UPCOMING}' end
if nowMs > endMs then return '${REPLY.SALE_ENDED}' end

if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then return '${REPLY.ALREADY_PURCHASED}' end
if tonumber(redis.call('GET', KEYS[2]) or '0') <= 0 then return '${REPLY.SOLD_OUT}' end

redis.call('DECR', KEYS[2])
redis.call('HSET', KEYS[3], ARGV[1], '${RESERVATION_ENTRY_PREFIX.RESERVED}' .. ARGV[3])
return '${REPLY.RESERVED}'
`;

export const ATTEMPT_PURCHASE_SCRIPT: LuaScriptDefinition = {
  name: 'attemptPurchase',
  numberOfKeys: ATTEMPT_PURCHASE_KEY_COUNT,
  lua: LUA,
};
