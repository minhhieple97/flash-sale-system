import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import type { AppRole } from './config/env.interface';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { LoggingModule } from './logging/logging.module';
import { AdminModule } from './modules/admin/admin.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { FlashSalesModule } from './modules/flash-sales/flash-sales.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProductsModule } from './modules/products/products.module';

const BASE_IMPORTS = [
  AppConfigModule,
  LoggingModule,
  DatabaseModule,
  RedisModule,
  QueueModule,
  HealthModule,
  MetricsModule,
];

@Module({})
class AppRoleModule {}

@Module({
  imports: [
    ...BASE_IMPORTS,
    ProductsModule,
    FlashSalesModule,
    OrdersModule,
    CheckoutModule,
    AdminModule,
  ],
})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS DynamicModule factory
export class AppModule {
  static forRole(role: AppRole): DynamicModule {
    if (role === 'worker') {
      return {
        module: AppRoleModule,
        imports: [...BASE_IMPORTS, OrdersModule.forRole('worker'), AdminModule.forRole('worker')],
      };
    }
    return {
      module: AppRoleModule,
      imports: [
        ...BASE_IMPORTS,
        ProductsModule,
        FlashSalesModule,
        OrdersModule.forRole(role),
        CheckoutModule,
        AdminModule.forRole(role),
      ],
    };
  }
}
