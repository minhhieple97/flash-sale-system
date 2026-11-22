import {
  RESTORE_SALE_REPLY as REPLY,
  RESTORE_SALE_KEY_COUNT,
} from '../constants/sale-ledger.constants';
import type { LuaScript } from './lua-script.interface';

type RestoreSaleArgs = [
  configKey: string,
  stockKey: string,
  usersKey: string,
  totalStock: number,
  configPairCount: number,
  ...fieldsAndValues: string[],
];

const LUA = `
local wrote = 0
local configEnd = 2 + tonumber(ARGV[2]) * 2

if redis.call('EXISTS', KEYS[1]) == 0 then
  for i = 3, configEnd, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
  wrote = 1
end

for i = configEnd + 1, #ARGV, 2 do
  if redis.call('HSETNX', KEYS[3], ARGV[i], ARGV[i + 1]) == 1 then wrote = 1 end
end

if redis.call('EXISTS', KEYS[2]) == 0 then
  redis.call('SET', KEYS[2], tonumber(ARGV[1]) - redis.call('HLEN', KEYS[3]))
  wrote = 1
end

if wrote == 1 then return ${REPLY.HYDRATED} end
return ${REPLY.ALREADY_PRESENT}
`;

export const RESTORE_SALE_SCRIPT: LuaScript<'restoreSale', RestoreSaleArgs> = {
  name: 'restoreSale',
  numberOfKeys: RESTORE_SALE_KEY_COUNT,
  lua: LUA,
};
