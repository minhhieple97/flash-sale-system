import { once } from 'node:events';
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppEnv } from '../../config/env.interface';
import { REDIS_CLIENT, REDIS_CLOSED_STATUS, REDIS_READY_EVENT } from './redis.constants';
import { hotPathRedisOptions } from './redis-connection.options';

/** With the offline queue off, a command sent before `ready` rejects, so the provider waits for it. */
async function connectHotPathClient(config: ConfigService<AppEnv, true>): Promise<Redis> {
  const client = new Redis(hotPathRedisOptions(config));
  try {
    await once(client, REDIS_READY_EVENT);
  } catch (error) {
    client.disconnect();
    throw error;
  }
  return client;
}

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: connectHotPathClient,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Quits in the shutdown phase, which Nest runs after every module's destroy hooks. The BullMQ
   * worker and queue close in the destroy phase, so in-flight jobs finish against a live client.
   * QUIT needs a writable stream; a client that is reconnecting has none, so it is dropped instead.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.isClosed()) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
      return;
    }
    if (!this.isClosed()) await once(this.redis, REDIS_CLOSED_STATUS);
  }

  private isClosed(): boolean {
    return this.redis.status === REDIS_CLOSED_STATUS;
  }
}
