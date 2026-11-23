import {
  ADOPT_ORDER_KEY_COUNT,
  ADOPT_ORDER_REPLY as REPLY,
  RESERVATION_ENTRY_PREFIX,
} from '../constants/sale-ledger.constants';
import type { LuaScript } from './lua-script.interface';

type AdoptOrderArgs = [stockKey: string, usersKey: string, userId: string, orderId: string];

const CONFIRMED_ENTRY = `'${RESERVATION_ENTRY_PREFIX.CONFIRMED}' .. ARGV[2]`;

const LUA = `
local held = redis.call('HGET', KEYS[2], ARGV[1])
if held == ${CONFIRMED_ENTRY} then return ${REPLY.ADOPTED} end
if held then return ${REPLY.NOT_ADOPTED} end

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return ${REPLY.NOT_ADOPTED} end

redis.call('DECR', KEYS[1])
redis.call('HSET', KEYS[2], ARGV[1], ${CONFIRMED_ENTRY})
return ${REPLY.ADOPTED}
`;

export const ADOPT_ORDER_SCRIPT: LuaScript<'adoptOrder', AdoptOrderArgs> = {
  name: 'adoptOrder',
  numberOfKeys: ADOPT_ORDER_KEY_COUNT,
  lua: LUA,
};
