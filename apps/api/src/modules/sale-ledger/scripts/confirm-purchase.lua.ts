import {
  CONFIRM_PURCHASE_KEY_COUNT,
  CONFIRM_PURCHASE_REPLY as REPLY,
  RESERVATION_ENTRY_PREFIX,
} from '../constants/sale-ledger.constants';
import type { LuaScript } from './lua-script.interface';

type ConfirmPurchaseArgs = [
  usersKey: string,
  userId: string,
  reservedOrderId: string,
  confirmedOrderId: string,
];

const CONFIRMED_ENTRY = `'${RESERVATION_ENTRY_PREFIX.CONFIRMED}' .. ARGV[3]`;

const LUA = `
local held = redis.call('HGET', KEYS[1], ARGV[1])
if held ~= '${RESERVATION_ENTRY_PREFIX.RESERVED}' .. ARGV[2] and held ~= ${CONFIRMED_ENTRY} then
  return ${REPLY.NOT_RESERVED}
end

redis.call('HSET', KEYS[1], ARGV[1], ${CONFIRMED_ENTRY})
return ${REPLY.CONFIRMED}
`;

export const CONFIRM_PURCHASE_SCRIPT: LuaScript<'confirmPurchase', ConfirmPurchaseArgs> = {
  name: 'confirmPurchase',
  numberOfKeys: CONFIRM_PURCHASE_KEY_COUNT,
  lua: LUA,
};
