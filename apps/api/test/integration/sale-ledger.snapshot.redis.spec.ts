import {
  SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSaleStockKey,
} from '../support/ledger-keys';
import { createSaleLedgerHarness, type SaleLedgerHarness } from '../support/sale-ledger.harness';

const LEGACY_PRODUCT_FIELDS = {
  productId: 'product-1',
  productName: 'Phone',
  salePriceCents: '500',
  originalPriceCents: '1000',
};

describe('SaleLedgerRepository.readSnapshot', () => {
  let harness: SaleLedgerHarness;
  let redis: SaleLedgerHarness['redis'];
  let repository: SaleLedgerHarness['ledger'];

  async function seedConfig(saleId: string, overrides: Record<string, string> = {}): Promise<void> {
    await redis.hset(flashSaleConfigKey(saleId), {
      [F.saleId]: saleId,
      [F.totalStock]: '10',
      [F.startTimeMs]: '1800000000000',
      [F.endTimeMs]: '1800003600000',
      ...overrides,
    });
  }

  const newSaleId = (): string => harness.newSaleId();

  beforeAll(async () => {
    harness = await createSaleLedgerHarness();
    ({ redis, ledger: repository } = harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reads the config hash and stock as a typed snapshot', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId);
    await redis.set(flashSaleStockKey(saleId), '7');

    const read = await repository.readSnapshot(saleId);

    expect(read).toEqual({
      status: 'FOUND',
      snapshot: {
        saleId,
        totalStock: 10,
        remainingStock: 7,
        startsAtMs: 1800000000000,
        endsAtMs: 1800003600000,
      },
    });
  });

  it('reads a hash written before the product fields were dropped', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId, LEGACY_PRODUCT_FIELDS);
    await redis.set(flashSaleStockKey(saleId), '7');

    const read = await repository.readSnapshot(saleId);

    expect(read).toEqual({
      status: 'FOUND',
      snapshot: {
        saleId,
        totalStock: 10,
        remainingStock: 7,
        startsAtMs: 1800000000000,
        endsAtMs: 1800003600000,
      },
    });
  });

  it('reads a missing config as NOT_CONFIGURED', async () => {
    await expect(repository.readSnapshot(newSaleId())).resolves.toEqual({
      status: 'NOT_CONFIGURED',
    });
  });

  it('reads a missing stock key under an existing config as STOCK_MISSING', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId);

    const read = repository.readSnapshot(saleId);

    await expect(read).resolves.toEqual({ status: 'STOCK_MISSING' });
  });

  it('rejects when a numeric field is corrupt', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId, { [F.totalStock]: 'abc' });
    await redis.set(flashSaleStockKey(saleId), '7');

    await expect(repository.readSnapshot(saleId)).rejects.toThrow(F.totalStock);
  });

  it('rejects when a text field is missing', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId);
    await redis.set(flashSaleStockKey(saleId), '7');
    await redis.hdel(flashSaleConfigKey(saleId), F.saleId);

    await expect(repository.readSnapshot(saleId)).rejects.toThrow(F.saleId);
  });
});
