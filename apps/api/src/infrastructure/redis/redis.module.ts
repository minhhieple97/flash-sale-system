import { once } from 'node:events';
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppEnv } from '../../config/env.interface';
import { REDIS_CLIENT, REDIS_CLOSED_STATUS } from './redis.constants';

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): Redis => {
        const host: string = config.get('REDIS_HOST', { infer: true });
        const port: number = config.get('REDIS_PORT', { infer: true });
        return new Redis({ host, port });
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
