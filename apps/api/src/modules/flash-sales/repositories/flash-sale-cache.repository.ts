import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  FLASH_SALE_CONFIG_FIELDS as FIELDS,
  flashSaleConfigKey,
  flashSaleStockKey,
  REDIS_CLIENT,
} from '../../../infrastructure/redis/redis.constants';
import type { FlashSaleSnapshot } from '../interfaces/flash-sale.interface';

type PipelineResult = [Error | null, unknown][] | null;

function requireText(raw: string | undefined, field: string): string {
  if (raw === undefined || raw === '') {
    throw new Error(`Corrupt flash sale field ${field}: ${String(raw)}`);
  }
  return raw;
}

function requireNumber(raw: string | undefined, field: string): number {
  const value = Number(requireText(raw, field));
  if (!Number.isFinite(value)) throw new Error(`Corrupt flash sale field ${field}: ${raw}`);
  return value;
}

function parseSnapshot(hash: Record<string, string>, stock: string | null): FlashSaleSnapshot {
  return {
    saleId: requireText(hash[FIELDS.saleId], FIELDS.saleId),
    productId: requireText(hash[FIELDS.productId], FIELDS.productId),
    productName: requireText(hash[FIELDS.productName], FIELDS.productName),
    salePriceCents: requireNumber(hash[FIELDS.salePriceCents], FIELDS.salePriceCents),
    originalPriceCents: requireNumber(hash[FIELDS.originalPriceCents], FIELDS.originalPriceCents),
    totalStock: requireNumber(hash[FIELDS.totalStock], FIELDS.totalStock),
    remainingStock: requireNumber(stock ?? '0', 'stock'),
    startsAtMs: requireNumber(hash[FIELDS.startTimeMs], FIELDS.startTimeMs),
    endsAtMs: requireNumber(hash[FIELDS.endTimeMs], FIELDS.endTimeMs),
  };
}

function unwrap<T>(result: PipelineResult, index: number): T {
  const entry = result?.[index];
  if (!entry) throw new Error('Redis MULTI returned no result');
  if (entry[0]) throw entry[0];
  return entry[1] as T;
}

@Injectable()
export class FlashSaleCacheRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async readSnapshot(saleId: string): Promise<FlashSaleSnapshot | null> {
    const result = await this.redis
      .multi()
      .hgetall(flashSaleConfigKey(saleId))
      .get(flashSaleStockKey(saleId))
      .exec();
    const hash = unwrap<Record<string, string>>(result, 0);
    if (Object.keys(hash).length === 0) return null;
    return parseSnapshot(hash, unwrap<string | null>(result, 1));
  }
}
