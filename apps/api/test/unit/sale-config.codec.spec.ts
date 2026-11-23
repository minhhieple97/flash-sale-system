import { buildSnapshot } from '../support/flash-sale.fixtures';
import {
  decodeSnapshot,
  encodeConfigFields,
  SALE_CONFIG_FIELDS as FIELDS,
} from '../support/ledger-keys';

const CORE_HASH = {
  saleId: 'sale-1',
  totalStock: '10',
  startTimeMs: '1800000000000',
  endTimeMs: '1800003600000',
};
const DECODED_CORE = {
  saleId: 'sale-1',
  totalStock: 10,
  remainingStock: 4,
  startsAtMs: 1_800_000_000_000,
  endsAtMs: 1_800_003_600_000,
};

describe('sale config codec', () => {
  it('decodes a legacy hash that still carries the four product fields', () => {
    const legacy = {
      ...CORE_HASH,
      productId: 'product-1',
      productName: 'Phone',
      salePriceCents: '500',
      originalPriceCents: '1000',
    };

    expect(decodeSnapshot(legacy, '4')).toEqual(DECODED_CORE);
  });

  it('decodes a hash without productName', () => {
    expect(decodeSnapshot(CORE_HASH, '4')).toEqual(DECODED_CORE);
  });

  it('decodes what it encodes back to the same snapshot', () => {
    const snapshot = buildSnapshot({ remainingStock: 7 });

    const decoded = decodeSnapshot(encodeConfigFields(snapshot), String(snapshot.remainingStock));

    expect(decoded).toEqual(snapshot);
  });

  it.each(Object.values(FIELDS))('throws when the %s field is missing', (field) => {
    const { [field]: _removed, ...hash } = encodeConfigFields(buildSnapshot());

    expect(() => decodeSnapshot(hash, '5')).toThrow(field);
  });

  it('throws when a numeric field is not a number', () => {
    const hash = { ...encodeConfigFields(buildSnapshot()), [FIELDS.totalStock]: 'many' };

    expect(() => decodeSnapshot(hash, '5')).toThrow(FIELDS.totalStock);
  });

  it('throws when the stock key is missing instead of reading a sold-out sale', () => {
    expect(() => decodeSnapshot(encodeConfigFields(buildSnapshot()), null)).toThrow('stock');
  });

  it('clamps negative raw stock to 0 while an over-reserved rollback is pending', () => {
    expect(decodeSnapshot(CORE_HASH, '-2')).toEqual({ ...DECODED_CORE, remainingStock: 0 });
  });
});
