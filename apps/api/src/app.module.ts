import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { FlashSalesModule } from './modules/flash-sales/flash-sales.module';
import { HealthModule } from './modules/health/health.module';
import { ProductsModule } from './modules/products/products.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    ProductsModule,
    FlashSalesModule,
    HealthModule,
  ],
})
export class AppModule {}
