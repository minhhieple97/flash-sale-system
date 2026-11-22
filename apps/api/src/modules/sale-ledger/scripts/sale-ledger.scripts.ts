import type Redis from 'ioredis';
import { ADOPT_ORDER_SCRIPT } from './adopt-order.lua';
import { ATTEMPT_PURCHASE_SCRIPT } from './attempt-purchase.lua';
import { CONFIRM_PURCHASE_SCRIPT } from './confirm-purchase.lua';
import type { LuaScript } from './lua-script.interface';
import { RELEASE_LOCK_SCRIPT } from './release-lock.lua';
import { RESTORE_CONFIRMED_BATCH_SCRIPT } from './restore-confirmed-batch.lua';
import { RESTORE_SALE_SCRIPT } from './restore-sale.lua';
import { ROLLBACK_PURCHASE_SCRIPT } from './rollback-purchase.lua';

export const SALE_LEDGER_SCRIPTS = [
  ATTEMPT_PURCHASE_SCRIPT,
  ROLLBACK_PURCHASE_SCRIPT,
  CONFIRM_PURCHASE_SCRIPT,
  ADOPT_ORDER_SCRIPT,
  RESTORE_SALE_SCRIPT,
  RELEASE_LOCK_SCRIPT,
  RESTORE_CONFIRMED_BATCH_SCRIPT,
] as const;

type SaleLedgerScript = (typeof SALE_LEDGER_SCRIPTS)[number];
export type SaleLedgerScriptName = SaleLedgerScript['name'];
type ArgsOf<S> = S extends LuaScript<string, infer A> ? A : never;

export type SaleLedgerScriptCommands = {
  [S in SaleLedgerScript as S['name']]: (...args: ArgsOf<S>) => Promise<unknown>;
};

export type SaleLedgerRedis = Redis & SaleLedgerScriptCommands;
