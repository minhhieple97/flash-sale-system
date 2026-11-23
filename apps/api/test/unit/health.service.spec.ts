import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import {
  HEALTH_PROBE_TIMEOUT_MS,
  HealthService,
} from '../../src/modules/health/services/health.service';

function buildService(query: () => Promise<unknown>, ping: () => Promise<string>): HealthService {
  return new HealthService(
    { query: jest.fn(query) } as unknown as DataSource,
    { ping: jest.fn(ping) } as unknown as Redis,
  );
}

describe('HealthService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports ok when both probes are up', async () => {
    const service = buildService(
      async () => [{ '?column?': 1 }],
      async () => 'PONG',
    );

    const report = await service.check();

    expect(report).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('reports error with database down when the database probe rejects', async () => {
    const service = buildService(
      async () => {
        throw new Error('connection refused');
      },
      async () => 'PONG',
    );

    const report = await service.check();

    expect(report).toEqual({ status: 'error', checks: { database: 'down', redis: 'up' } });
  });

  it('reports redis down when the redis probe does not reply PONG', async () => {
    const service = buildService(
      async () => [{ '?column?': 1 }],
      async () => 'UNEXPECTED',
    );

    const report = await service.check();

    expect(report).toEqual({ status: 'error', checks: { database: 'up', redis: 'down' } });
  });

  it('reports down for a probe that never settles once the timeout elapses', async () => {
    jest.useFakeTimers();
    const service = buildService(
      () => new Promise<unknown>(() => undefined),
      async () => 'PONG',
    );

    const pending = service.check();
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS);
    const report = await pending;

    expect(report).toEqual({ status: 'error', checks: { database: 'down', redis: 'up' } });
  });

  it('clears the probe timer when the probe settles', async () => {
    jest.useFakeTimers();
    const service = buildService(
      async () => [{ '?column?': 1 }],
      async () => 'PONG',
    );

    await service.check();

    expect(jest.getTimerCount()).toBe(0);
  });
});
