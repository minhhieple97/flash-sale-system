import { Test, type TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AppConfigModule } from '../../src/config/app-config.module';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.constants';
import { RedisModule } from '../../src/infrastructure/redis/redis.module';

describe('RedisModule', () => {
  let moduleRef: TestingModule;
  let client: Redis;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, RedisModule],
    }).compile();
    await moduleRef.init();
    client = moduleRef.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('provides a client that answers PING with PONG', async () => {
    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('connects to the configured REDIS_PORT', () => {
    expect(client.options.port).toBe(Number(process.env.REDIS_PORT));
  });

  it('quits the client when the module closes', async () => {
    const closing = await Test.createTestingModule({
      imports: [AppConfigModule, RedisModule],
    }).compile();
    await closing.init();
    const closingClient = closing.get<Redis>(REDIS_CLIENT);

    await closing.close();

    expect(closingClient.status).toBe('end');
  });
});
