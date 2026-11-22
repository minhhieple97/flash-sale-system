import {
  RESTORE_CONFIRMED_BATCH_REPLY as REPLY,
  RESTORE_CONFIRMED_BATCH_KEY_COUNT,
} from '../constants/sale-ledger.constants';
import type { LuaScript } from './lua-script.interface';

type RestoreConfirmedBatchArgs = [usersKey: string, ...entries: string[]];

const LUA = `
local wrote = 0
for i = 1, #ARGV, 2 do
  if redis.call('HSETNX', KEYS[1], ARGV[i], ARGV[i + 1]) == 1 then
    wrote = 1
  end
end
if wrote == 1 then return ${REPLY.WROTE} end
return ${REPLY.NOOP}
`;

export const RESTORE_CONFIRMED_BATCH_SCRIPT: LuaScript<
  'restoreConfirmedBatch',
  RestoreConfirmedBatchArgs
> = {
  name: 'restoreConfirmedBatch',
  numberOfKeys: RESTORE_CONFIRMED_BATCH_KEY_COUNT,
  lua: LUA,
};
