import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../src/config/env.interface';
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_FAIL_FAST_MAX_RETRIES,
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_RECONNECT_STEP_MS,
} from '../../src/infrastructure/redis/redis.constants';
import {
  hotPathRedisOptions,
  queueProducerRedisOptions,
  queueWorkerRedisOptions,
} from '../../src/infrastructure/redis/redis-connection.options';

const REDIS_HOST = 'redis.internal';
const REDIS_PORT = 16_390;
const FAIL_FAST = {
  enableOfflineQueue: false,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: REDIS_FAIL_FAST_MAX_RETRIES,
  retryStrategy: expect.any(Function),
};

describe('Redis connection options', () => {
  const config = new ConfigService<AppEnv, true>({ REDIS_HOST, REDIS_PORT });

  it('makes the hot-path connection fail fast and auto-pipeline', () => {
    const options = hotPathRedisOptions(config);

    expect(options).toEqual({
      host: REDIS_HOST,
      port: REDIS_PORT,
      ...FAIL_FAST,
      enableAutoPipelining: true,
    });
  });

  it('makes the queue producer connection fail fast without auto-pipelining', () => {
    const options = queueProducerRedisOptions(config);

    expect(options).toEqual({ host: REDIS_HOST, port: REDIS_PORT, ...FAIL_FAST });
  });

  it.each([
    ['hot-path', hotPathRedisOptions],
    ['producer', queueProducerRedisOptions],
  ])('reconnects the %s connection in growing steps up to a cap', (_name, build) => {
    const { retryStrategy } = build(config);

    const delays = [1, 2, 1_000].map(retryStrategy);

    expect(delays).toEqual([
      REDIS_RECONNECT_STEP_MS,
      2 * REDIS_RECONNECT_STEP_MS,
      REDIS_RECONNECT_MAX_DELAY_MS,
    ]);
  });

  it('leaves the worker connection to the defaults its blocking commands need', () => {
    const options = queueWorkerRedisOptions(config);

    expect(options).toEqual({ host: REDIS_HOST, port: REDIS_PORT });
  });
});
