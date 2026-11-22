import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { HealthController } from './controllers/health.controller';
import { HealthRepository } from './repositories/health.repository';
import { HealthCacheRepository } from './repositories/health-cache.repository';
import { HealthService } from './services/health.service';

@Module({
  imports: [RedisModule],
  controllers: [HealthController],
  providers: [HealthRepository, HealthCacheRepository, HealthService],
})
export class HealthModule {}
