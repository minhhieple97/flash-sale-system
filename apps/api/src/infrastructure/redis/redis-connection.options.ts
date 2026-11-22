import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.interface';
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_FAIL_FAST_MAX_RETRIES,
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_RECONNECT_STEP_MS,
} from './redis.constants';

export interface RedisConnectionOptions {
  host: string;
  port: number;
}

export interface FailFastRedisOptions extends RedisConnectionOptions {
  enableOfflineQueue: false;
  commandTimeout: number;
  maxRetriesPerRequest: number;
  retryStrategy: (attempt: number) => number;
}

export interface HotPathRedisOptions extends FailFastRedisOptions {
  enableAutoPipelining: true;
}

function configuredEndpoint(config: ConfigService<AppEnv, true>): RedisConnectionOptions {
  return {
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
  };
}

function reconnectDelayMs(attempt: number): number {
  return Math.min(attempt * REDIS_RECONNECT_STEP_MS, REDIS_RECONNECT_MAX_DELAY_MS);
}

function failFast(config: ConfigService<AppEnv, true>): FailFastRedisOptions {
  return {
    ...configuredEndpoint(config),
    enableOfflineQueue: false,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: REDIS_FAIL_FAST_MAX_RETRIES,
    retryStrategy: reconnectDelayMs,
  };
}

export function hotPathRedisOptions(config: ConfigService<AppEnv, true>): HotPathRedisOptions {
  return { ...failFast(config), enableAutoPipelining: true };
}

export function queueProducerRedisOptions(
  config: ConfigService<AppEnv, true>,
): FailFastRedisOptions {
  return failFast(config);
}

/**
 * The registered queue, whose connection the BullMQ worker and its blocking client inherit. These
 * keep the ioredis defaults: a blocking command waits longer than any command timeout, and the
 * worker queues its commands across a reconnect instead of failing them.
 */
export function queueWorkerRedisOptions(
  config: ConfigService<AppEnv, true>,
): RedisConnectionOptions {
  return configuredEndpoint(config);
}
