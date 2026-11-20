import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { LoggingModule } from './logging/logging.module';
import { AdminModule } from './modules/admin/admin.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { FlashSalesModule } from './modules/flash-sales/flash-sales.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProductsModule } from './modules/products/products.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    ProductsModule,
    FlashSalesModule,
    HealthModule,
    OrdersModule,
    CheckoutModule,
    AdminModule,
  ],
})
export class AppModule {}
