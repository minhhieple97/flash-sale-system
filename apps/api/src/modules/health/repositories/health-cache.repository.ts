import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import type { FlashSaleRedis } from '../../../infrastructure/redis/redis.interfaces';
import { REDIS_PING_REPLY } from '../constants/health.constants';

@Injectable()
export class HealthCacheRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: FlashSaleRedis) {}

  async isRedisReachable(): Promise<boolean> {
    return (await this.redis.ping()) === REDIS_PING_REPLY;
  }
}
