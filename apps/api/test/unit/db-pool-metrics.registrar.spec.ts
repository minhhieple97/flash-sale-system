import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  DbPoolMetricsRegistrar,
  extractDbPoolCounts,
} from '../../src/modules/metrics/collectors/db-pool-metrics.registrar';
import { MetricsModule } from '../../src/modules/metrics/metrics.module';
import { MetricsService } from '../../src/modules/metrics/services/metrics.service';

describe('DbPoolMetricsRegistrar', () => {
  it('reads totalCount, idleCount, and waitingCount from the pg master pool', async () => {
    const metrics = new MetricsService();
    const dataSource = {
      driver: {
        master: { totalCount: 12, idleCount: 7, waitingCount: 2 },
      },
    } as unknown as DataSource;
    const registrar = new DbPoolMetricsRegistrar(metrics, dataSource);

    registrar.onApplicationBootstrap();
    const output = await metrics.render();

    expect(output).toContain('# TYPE flash_sale_db_pool_connections gauge');
    expect(output).toContain('flash_sale_db_pool_connections{state="total"} 12');
    expect(output).toContain('flash_sale_db_pool_connections{state="idle"} 7');
    expect(output).toContain('flash_sale_db_pool_connections{state="waiting"} 2');
  });

  it('skips registration when DataSource is not provided', async () => {
    const metrics = new MetricsService();
    const registrar = new DbPoolMetricsRegistrar(metrics);

    registrar.onApplicationBootstrap();
    const output = await metrics.render();

    expect(output).not.toContain('flash_sale_db_pool_connections');
  });

  it.each([
    ['missing driver', {}],
    ['missing master pool', { driver: {} }],
    ['null master pool', { driver: { master: null } }],
    ['incomplete pool object', { driver: { master: { totalCount: 1, idleCount: 'bad' } } }],
  ])('returns null cleanly for %s', (_label, candidate) => {
    expect(extractDbPoolCounts(candidate as unknown as DataSource)).toBeNull();
  });

  it('wires automatically through Nest DI when a global DataSource provider is registered', async () => {
    const fakeDataSource = {
      driver: { master: { totalCount: 8, idleCount: 5, waitingCount: 0 } },
    } as unknown as DataSource;

    @Global()
    @Module({
      providers: [{ provide: getDataSourceToken(), useValue: fakeDataSource }],
      exports: [getDataSourceToken()],
    })
    class FakeDatabaseModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [FakeDatabaseModule, MetricsModule],
    }).compile();
    await moduleRef.init();
    try {
      const output = await moduleRef.get(MetricsService).render();

      expect(output).toContain('flash_sale_db_pool_connections{state="total"} 8');
      expect(output).toContain('flash_sale_db_pool_connections{state="idle"} 5');
      expect(output).toContain('flash_sale_db_pool_connections{state="waiting"} 0');
    } finally {
      await moduleRef.close();
    }
  });
});
