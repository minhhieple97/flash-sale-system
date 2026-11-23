import { Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { DbPoolCounts } from '../interfaces/metrics.interface';
import { MetricsService } from '../services/metrics.service';

interface PgPoolCounters {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

function isPgPoolCounters(value: unknown): value is PgPoolCounters {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.totalCount === 'number' &&
    typeof record.idleCount === 'number' &&
    typeof record.waitingCount === 'number'
  );
}

export function extractDbPoolCounts(dataSource: DataSource): DbPoolCounts | null {
  const driver = dataSource.driver as { readonly master?: unknown } | undefined;
  const pool = driver?.master;
  if (!isPgPoolCounters(pool)) return null;
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

@Injectable()
export class DbPoolMetricsRegistrar implements OnApplicationBootstrap {
  constructor(
    private readonly metrics: MetricsService,
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
  ) {}

  onApplicationBootstrap(): void {
    if (this.dataSource === undefined) return;
    const dataSource = this.dataSource;
    this.metrics.registerDbPoolCollector(() => extractDbPoolCounts(dataSource));
  }
}
