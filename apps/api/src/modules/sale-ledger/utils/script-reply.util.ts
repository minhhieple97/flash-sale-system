import {
  ADOPT_ORDER_REPLY,
  CONFIRM_PURCHASE_REPLY,
  RESTORE_CONFIRMED_BATCH_REPLY,
  RESTORE_SALE_REPLY,
  ROLLBACK_PURCHASE_REPLY,
} from '../constants/sale-ledger.constants';
import type { ReservationVerdict } from '../interfaces/sale-ledger.interface';

const VERDICTS: Readonly<Record<ReservationVerdict, true>> = {
  RESERVED: true,
  ALREADY_PURCHASED: true,
  SOLD_OUT: true,
  SALE_UPCOMING: true,
  SALE_ENDED: true,
  SALE_NOT_CONFIGURED: true,
};

const SCRIPT_REPLIES = {
  rollbackPurchase: {
    [ROLLBACK_PURCHASE_REPLY.RELEASED]: 'RELEASED',
    [ROLLBACK_PURCHASE_REPLY.NOT_RESERVED]: 'NOT_RESERVED',
  },
  confirmPurchase: {
    [CONFIRM_PURCHASE_REPLY.CONFIRMED]: 'CONFIRMED',
    [CONFIRM_PURCHASE_REPLY.NOT_RESERVED]: 'NOT_RESERVED',
  },
  adoptOrder: {
    [ADOPT_ORDER_REPLY.ADOPTED]: 'ADOPTED',
    [ADOPT_ORDER_REPLY.NOT_ADOPTED]: 'NOT_ADOPTED',
  },
  restoreSale: {
    [RESTORE_SALE_REPLY.HYDRATED]: 'HYDRATED',
    [RESTORE_SALE_REPLY.ALREADY_PRESENT]: 'ALREADY_PRESENT',
  },
  restoreConfirmedBatch: {
    [RESTORE_CONFIRMED_BATCH_REPLY.WROTE]: 'WROTE',
    [RESTORE_CONFIRMED_BATCH_REPLY.NOOP]: 'NOOP',
  },
} as const;

export const isVerdict = (reply: unknown): reply is ReservationVerdict =>
  typeof reply === 'string' && Object.hasOwn(VERDICTS, reply);

export function unexpectedReply(script: string, reply: unknown): Error {
  return new Error(`Unexpected ${script} reply: ${String(reply)}`);
}

type ScriptTable = typeof SCRIPT_REPLIES;
type ScriptOutcome<K extends keyof ScriptTable> = ScriptTable[K][0 | 1];

export function mapScriptReply<K extends keyof ScriptTable>(
  script: K,
  reply: unknown,
): ScriptOutcome<K> {
  if (reply === 0 || reply === 1) {
    return SCRIPT_REPLIES[script][reply] as ScriptOutcome<K>;
  }
  throw unexpectedReply(script, reply);
}
