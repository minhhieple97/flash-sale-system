import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AppConfigModule } from '../../src/config/app-config.module';
import {
  FLASH_SALE_CONFIG_FIELDS as F,
  flashSaleConfigKey,
  flashSaleStockKey,
  REDIS_CLIENT,
} from '../../src/infrastructure/redis/redis.constants';
import { RedisModule } from '../../src/infrastructure/redis/redis.module';
import { FlashSaleCacheRepository } from '../../src/modules/flash-sales/repositories/flash-sale-cache.repository';

describe('FlashSaleCacheRepository', () => {
  let moduleRef: TestingModule;
  let redis: Redis;
  let repository: FlashSaleCacheRepository;
  const saleIds: string[] = [];

  async function seedConfig(saleId: string, overrides: Record<string, string> = {}): Promise<void> {
    await redis.hset(flashSaleConfigKey(saleId), {
      [F.saleId]: saleId,
      [F.productId]: 'product-1',
      [F.productName]: 'Phone',
      [F.salePriceCents]: '500',
      [F.originalPriceCents]: '1000',
      [F.totalStock]: '10',
      [F.startTimeMs]: '1800000000000',
      [F.endTimeMs]: '1800003600000',
      ...overrides,
    });
  }

  function newSaleId(): string {
    const saleId = randomUUID();
    saleIds.push(saleId);
    return saleId;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, RedisModule],
      providers: [FlashSaleCacheRepository],
    }).compile();
    await moduleRef.init();
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
    repository = moduleRef.get(FlashSaleCacheRepository);
  });

  afterAll(async () => {
    const keys = saleIds.flatMap((id) => [flashSaleConfigKey(id), flashSaleStockKey(id)]);
    await redis.del(...keys);
    await moduleRef.close();
  });

  it('reads the config hash and stock as a typed snapshot', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId);
    await redis.set(flashSaleStockKey(saleId), '7');

    const snapshot = await repository.readSnapshot(saleId);

    expect(snapshot).toEqual({
      saleId,
      productId: 'product-1',
      productName: 'Phone',
      salePriceCents: 500,
      originalPriceCents: 1000,
      totalStock: 10,
      remainingStock: 7,
      startsAtMs: 1800000000000,
      endsAtMs: 1800003600000,
    });
  });

  it('reads a missing config as null', async () => {
    await expect(repository.readSnapshot(newSaleId())).resolves.toBeNull();
  });

  it('rejects when the config hash exists but the stock key is missing', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId);

    const read = repository.readSnapshot(saleId);

    await expect(read).rejects.toThrow('stock');
  });

  it('rejects when a numeric field is corrupt', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId, { [F.totalStock]: 'abc' });

    await expect(repository.readSnapshot(saleId)).rejects.toThrow(F.totalStock);
  });

  it('rejects when a text field is missing', async () => {
    const saleId = newSaleId();
    await seedConfig(saleId);
    await redis.hdel(flashSaleConfigKey(saleId), F.productName);

    await expect(repository.readSnapshot(saleId)).rejects.toThrow(F.productName);
  });
});
