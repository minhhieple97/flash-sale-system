import Redis from 'ioredis';

const DEFAULT_REDIS_PORT = 6379;

describe('integration guard against the default Redis port', () => {
  it('refuses a client that falls back to port 6379 when REDIS_PORT points elsewhere', async () => {
    if (process.env.REDIS_PORT === String(DEFAULT_REDIS_PORT)) return;
    const client = new Redis({
      port: DEFAULT_REDIS_PORT,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);

    await expect(client.connect()).rejects.toThrow(/refusing to connect to the default Redis port/);

    client.disconnect();
  });
});
