import { Injectable } from '@nestjs/common';
import { HEALTH_PROBE_TIMEOUT_MS } from '../constants/health.constants';
import type { DependencyState, HealthReport } from '../interfaces/health.interface';
import { HealthRepository } from '../repositories/health.repository';
import { HealthCacheRepository } from '../repositories/health-cache.repository';

@Injectable()
export class HealthService {
  constructor(
    private readonly healthRepository: HealthRepository,
    private readonly healthCacheRepository: HealthCacheRepository,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.healthRepository.isDatabaseReachable()),
      this.probe(() => this.healthCacheRepository.isRedisReachable()),
    ]);
    const status = database === 'up' && redis === 'up' ? 'ok' : 'error';
    return { status, checks: { database, redis } };
  }

  private async probe(run: () => Promise<boolean>): Promise<DependencyState> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), HEALTH_PROBE_TIMEOUT_MS);
    });
    try {
      const isUp = await Promise.race([run(), timeout]);
      return isUp ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
