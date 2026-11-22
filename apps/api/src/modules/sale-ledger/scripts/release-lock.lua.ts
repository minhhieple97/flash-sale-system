import {
  RELEASE_LOCK_KEY_COUNT,
  RELEASE_LOCK_REPLY as REPLY,
} from '../constants/sale-ledger.constants';
import type { LuaScript } from './lua-script.interface';

type ReleaseLockArgs = [lockKey: string, ownerToken: string];

const LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return ${REPLY.RELEASED}
end
return ${REPLY.NOT_OWNER}
`;

export const RELEASE_LOCK_SCRIPT: LuaScript<'releaseLock', ReleaseLockArgs> = {
  name: 'releaseLock',
  numberOfKeys: RELEASE_LOCK_KEY_COUNT,
  lua: LUA,
};
