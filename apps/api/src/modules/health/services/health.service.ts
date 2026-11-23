import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';

export const HEALTH_PROBE_TIMEOUT_MS = 1000;
const DATABASE_PROBE_SQL = 'SELECT 1';
const REDIS_PING_REPLY = 'PONG';

export type DependencyState = 'up' | 'down';
export type HealthStatus = 'ok' | 'error';

export interface HealthReport {
  status: HealthStatus;
  checks: { database: DependencyState; redis: DependencyState };
}

export const HEALTH_HTTP_STATUS: Readonly<Record<HealthStatus, HttpStatus>> = {
  ok: HttpStatus.OK,
  error: HttpStatus.SERVICE_UNAVAILABLE,
};

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      this.probe(async () => {
        await this.dataSource.query(DATABASE_PROBE_SQL);
        return true;
      }),
      this.probe(async () => (await this.redis.ping()) === REDIS_PING_REPLY),
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
      return (await Promise.race([run(), timeout])) ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
