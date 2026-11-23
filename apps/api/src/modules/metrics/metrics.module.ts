import { Module } from '@nestjs/common';
import { DbPoolMetricsRegistrar } from './collectors/db-pool-metrics.registrar';
import { MetricsController } from './controllers/metrics.controller';
import { MetricsService } from './services/metrics.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, DbPoolMetricsRegistrar],
  exports: [MetricsService],
})
export class MetricsModule {}
