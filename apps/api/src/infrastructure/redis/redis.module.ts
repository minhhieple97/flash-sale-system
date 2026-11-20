import { once } from 'node:events';
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppEnv } from '../../config/env.interface';
import { ATTEMPT_PURCHASE_SCRIPT } from './lua/attempt-purchase.lua';
import { ROLLBACK_PURCHASE_SCRIPT } from './lua/rollback-purchase.lua';
import { REDIS_CLIENT, REDIS_CLOSED_STATUS } from './redis.constants';
import type { FlashSaleRedis } from './redis.interfaces';

const FLASH_SALE_SCRIPTS = [ATTEMPT_PURCHASE_SCRIPT, ROLLBACK_PURCHASE_SCRIPT];

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): FlashSaleRedis => {
        const host: string = config.get('REDIS_HOST', { infer: true });
        const port: number = config.get('REDIS_PORT', { infer: true });
        const client = new Redis({ host, port });
        for (const { name, numberOfKeys, lua } of FLASH_SALE_SCRIPTS) {
          client.defineCommand(name, { numberOfKeys, lua });
        }
        // defineCommand attaches the methods at runtime, so the type cannot see them.
        return client as FlashSaleRedis;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === REDIS_CLOSED_STATUS) return;
    const closed = once(this.redis, REDIS_CLOSED_STATUS);
    await this.redis.quit();
    await closed;
  }
}
