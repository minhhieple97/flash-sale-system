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

function readText(hash: Record<string, string>, field: string): string {
  const value = hash[field];
  if (value === undefined || value === '') {
    throw new Error(`Corrupt flash sale field ${field}: ${String(value)}`);
  }
  return value;
}

function readNumber(hash: Record<string, string>, field: string): number {
  const value = Number(readText(hash, field));
  if (!Number.isFinite(value)) throw new Error(`Corrupt flash sale field ${field}: ${hash[field]}`);
  return value;
}

function parseSnapshot(hash: Record<string, string>, stock: string | null): FlashSaleSnapshot {
  return {
    saleId: readText(hash, FIELDS.saleId),
    productId: readText(hash, FIELDS.productId),
    productName: readText(hash, FIELDS.productName),
    salePriceCents: readNumber(hash, FIELDS.salePriceCents),
    originalPriceCents: readNumber(hash, FIELDS.originalPriceCents),
    totalStock: readNumber(hash, FIELDS.totalStock),
    remainingStock: readNumber({ stock: stock ?? '0' }, 'stock'),
    startsAtMs: readNumber(hash, FIELDS.startTimeMs),
    endsAtMs: readNumber(hash, FIELDS.endTimeMs),
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
