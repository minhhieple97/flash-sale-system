import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import type { AppRole } from '../../config/env.interface';
import { orderPersistenceProducerProvider } from '../../infrastructure/queue/order-persistence-producer.provider';
import { ORDER_PERSISTENCE_QUEUE } from '../../infrastructure/queue/queue.constants';
import { MetricsModule } from '../metrics/metrics.module';
import { SaleLedgerModule } from '../sale-ledger';
import { OrdersController } from './controllers/orders.controller';
import { OrderPersistenceProcessor } from './processors/order-persistence.processor';
import { OrdersRepository } from './repositories/orders.repository';
import { OrderPersistenceService } from './services/order-persistence.service';
import { OrdersService } from './services/orders.service';
import { OrphanSweeper } from './services/orphan-sweeper.service';

@Module({
  imports: [CommonModule, SaleLedgerModule, MetricsModule],
  providers: [
    orderPersistenceProducerProvider,
    OrdersRepository,
    OrdersService,
    OrderPersistenceService,
    OrphanSweeper,
  ],
  exports: [OrdersService, OrderPersistenceService, OrphanSweeper],
})
export class OrdersCoreModule {}

@Module({})
class OrdersRoleModule {}

const ORDERS_WORKER_IMPORTS = [
  CommonModule,
  OrdersCoreModule,
  BullModule.registerQueue({ name: ORDER_PERSISTENCE_QUEUE }),
];

@Module({
  imports: ORDERS_WORKER_IMPORTS,
  controllers: [OrdersController],
  providers: [OrderPersistenceProcessor],
  exports: [OrdersCoreModule],
})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS DynamicModule factory
export class OrdersModule {
  static forRole(role: AppRole): DynamicModule {
    return {
      module: OrdersRoleModule,
      imports: role === 'api' ? [CommonModule, OrdersCoreModule] : ORDERS_WORKER_IMPORTS,
      controllers: role === 'worker' ? [] : [OrdersController],
      providers: role === 'api' ? [] : [OrderPersistenceProcessor],
      exports: [OrdersCoreModule],
    };
  }
}
