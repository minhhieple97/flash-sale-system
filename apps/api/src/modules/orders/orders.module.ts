import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
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
  imports: [
    CommonModule,
    SaleLedgerModule,
    MetricsModule,
    BullModule.registerQueue({ name: ORDER_PERSISTENCE_QUEUE }),
  ],
  controllers: [OrdersController],
  providers: [
    orderPersistenceProducerProvider,
    OrdersRepository,
    OrdersService,
    OrderPersistenceService,
    OrphanSweeper,
    OrderPersistenceProcessor,
  ],
  exports: [OrdersService, OrderPersistenceService, OrphanSweeper],
})
export class OrdersModule {}
