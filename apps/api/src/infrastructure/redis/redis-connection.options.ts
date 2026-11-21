import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.interface';

export interface RedisConnectionOptions {
  host: string;
  port: number;
}

export function redisConnectionOptions(
  config: ConfigService<AppEnv, true>,
): RedisConnectionOptions {
  return {
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
  };
}
