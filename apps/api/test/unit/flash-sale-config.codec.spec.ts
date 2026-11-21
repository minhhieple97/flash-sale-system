import {
  decodeSnapshot,
  encodeConfigFields,
} from '../../src/infrastructure/redis/flash-sale-config.codec';
import { FLASH_SALE_CONFIG_FIELDS as FIELDS } from '../../src/infrastructure/redis/redis.constants';
import { buildSnapshot } from '../support/flash-sale.fixtures';

describe('flash sale config codec', () => {
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
});
