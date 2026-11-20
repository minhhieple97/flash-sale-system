import { HEALTH_PROBE_TIMEOUT_MS } from '../../src/modules/health/constants/health.constants';
import type { HealthRepository } from '../../src/modules/health/repositories/health.repository';
import type { HealthCacheRepository } from '../../src/modules/health/repositories/health-cache.repository';
import { HealthService } from '../../src/modules/health/services/health.service';

type Probe = jest.Mock<Promise<boolean>, []>;

function buildService(database: Probe, redis: Probe): HealthService {
  return new HealthService(
    { isDatabaseReachable: database } as unknown as HealthRepository,
    { isRedisReachable: redis } as unknown as HealthCacheRepository,
  );
}

function probe(result: () => Promise<boolean>): Probe {
  return jest.fn<Promise<boolean>, []>(result);
}

describe('HealthService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports ok when both probes are up', async () => {
    const service = buildService(
      probe(async () => true),
      probe(async () => true),
    );

    const report = await service.check();

    expect(report).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('reports error with database down when the database probe rejects', async () => {
    const service = buildService(
      probe(async () => {
        throw new Error('connection refused');
      }),
      probe(async () => true),
    );

    const report = await service.check();

    expect(report).toEqual({ status: 'error', checks: { database: 'down', redis: 'up' } });
  });

  it('reports redis down when the redis probe returns false', async () => {
    const service = buildService(
      probe(async () => true),
      probe(async () => false),
    );

    const report = await service.check();

    expect(report).toEqual({ status: 'error', checks: { database: 'up', redis: 'down' } });
  });

  it('reports down for a probe that never settles once the timeout elapses', async () => {
    jest.useFakeTimers();
    const service = buildService(
      probe(() => new Promise<boolean>(() => undefined)),
      probe(async () => true),
    );

    const pending = service.check();
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS);
    const report = await pending;

    expect(report).toEqual({ status: 'error', checks: { database: 'down', redis: 'up' } });
  });

  it('clears the probe timer when the probe settles', async () => {
    jest.useFakeTimers();
    const service = buildService(
      probe(async () => true),
      probe(async () => true),
    );

    await service.check();

    expect(jest.getTimerCount()).toBe(0);
  });
});
