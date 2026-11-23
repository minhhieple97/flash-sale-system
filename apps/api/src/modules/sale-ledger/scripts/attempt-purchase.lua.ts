import {
  ATTEMPT_PURCHASE_KEY_COUNT,
  RESERVATION_ENTRY_PREFIX,
  SALE_CONFIG_FIELDS,
} from '../constants/sale-ledger.constants';
import type { ReservationVerdict } from '../interfaces/sale-ledger.interface';
import type { LuaScript } from './lua-script.interface';

type AttemptPurchaseArgs = [
  configKey: string,
  stockKey: string,
  usersKey: string,
  pendingKey: string,
  userId: string,
  nowMs: number,
  orderId: string,
];

const reply = (verdict: ReservationVerdict): string => `return '${verdict}'`;

const LUA = `
if redis.call('HGET', KEYS[3], ARGV[1]) == '${RESERVATION_ENTRY_PREFIX.RESERVED}' .. ARGV[3] then
  redis.call('ZADD', KEYS[4], 'NX', ARGV[2], ARGV[1])
  ${reply('RESERVED')}
end

local startMs = tonumber(redis.call('HGET', KEYS[1], '${SALE_CONFIG_FIELDS.startTimeMs}'))
local endMs = tonumber(redis.call('HGET', KEYS[1], '${SALE_CONFIG_FIELDS.endTimeMs}'))
if not startMs or not endMs then ${reply('SALE_NOT_CONFIGURED')} end

local nowMs = tonumber(ARGV[2])
if nowMs < startMs then ${reply('SALE_UPCOMING')} end
if nowMs > endMs then ${reply('SALE_ENDED')} end

if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then ${reply('ALREADY_PURCHASED')} end
local stock = tonumber(redis.call('GET', KEYS[2]))
if not stock then ${reply('SALE_NOT_CONFIGURED')} end
if stock <= 0 then ${reply('SOLD_OUT')} end

redis.call('DECR', KEYS[2])
redis.call('HSET', KEYS[3], ARGV[1], '${RESERVATION_ENTRY_PREFIX.RESERVED}' .. ARGV[3])
redis.call('ZADD', KEYS[4], ARGV[2], ARGV[1])
${reply('RESERVED')}
`;

export const ATTEMPT_PURCHASE_SCRIPT: LuaScript<'attemptPurchase', AttemptPurchaseArgs> = {
  name: 'attemptPurchase',
  numberOfKeys: ATTEMPT_PURCHASE_KEY_COUNT,
  lua: LUA,
};
