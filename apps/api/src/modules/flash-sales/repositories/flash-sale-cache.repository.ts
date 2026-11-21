import { Inject, Injectable } from '@nestjs/common';
import { decodeSnapshot } from '../../../infrastructure/redis/flash-sale-config.codec';
import {
  flashSaleConfigKey,
  flashSaleStockKey,
  REDIS_CLIENT,
} from '../../../infrastructure/redis/redis.constants';
import type { FlashSaleRedis } from '../../../infrastructure/redis/redis.interfaces';
import { unwrapTransaction } from '../../../infrastructure/redis/redis-transaction.util';
import type { FlashSaleSnapshot } from '../interfaces/flash-sale.interface';

@Injectable()
export class FlashSaleCacheRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: FlashSaleRedis) {}

  async readSnapshot(saleId: string): Promise<FlashSaleSnapshot | null> {
    const result = await this.redis
      .multi()
      .hgetall(flashSaleConfigKey(saleId))
      .get(flashSaleStockKey(saleId))
      .exec();
    const [hash, stock] = unwrapTransaction(result) as [Record<string, string>, string | null];
    if (Object.keys(hash).length === 0) return null;
    return decodeSnapshot(hash, stock);
  }
}
