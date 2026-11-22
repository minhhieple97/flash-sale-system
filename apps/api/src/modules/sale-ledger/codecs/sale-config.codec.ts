import { SALE_CONFIG_FIELDS as FIELDS } from '../constants/sale-ledger.constants';
import type { FlashSaleSnapshot } from '../interfaces/sale-ledger.interface';

const STOCK_FIELD = 'stock';

/** Wire format of the `flash_sale:{saleId}:config` hash. Stock lives in its own key. */
export function encodeConfigFields(snapshot: FlashSaleSnapshot): Record<string, string> {
  return {
    [FIELDS.saleId]: snapshot.saleId,
    [FIELDS.totalStock]: String(snapshot.totalStock),
    [FIELDS.startTimeMs]: String(snapshot.startsAtMs),
    [FIELDS.endTimeMs]: String(snapshot.endsAtMs),
  };
}

function requireText(raw: string | null | undefined, field: string): string {
  if (raw === undefined || raw === null || raw === '') {
    throw new Error(`Corrupt flash sale field ${field}: ${String(raw)}`);
  }
  return raw;
}

function requireNumber(raw: string | null | undefined, field: string): number {
  const value = Number(requireText(raw, field));
  if (!Number.isFinite(value)) throw new Error(`Corrupt flash sale field ${field}: ${raw}`);
  return value;
}

export function decodeSnapshot(
  hash: Record<string, string>,
  stock: string | null,
): FlashSaleSnapshot {
  return {
    saleId: requireText(hash[FIELDS.saleId], FIELDS.saleId),
    totalStock: requireNumber(hash[FIELDS.totalStock], FIELDS.totalStock),
    remainingStock: requireNumber(stock, STOCK_FIELD),
    startsAtMs: requireNumber(hash[FIELDS.startTimeMs], FIELDS.startTimeMs),
    endsAtMs: requireNumber(hash[FIELDS.endTimeMs], FIELDS.endTimeMs),
  };
}
