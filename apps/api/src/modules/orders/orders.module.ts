import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ORDER_PERSISTENCE_QUEUE } from '../../infrastructure/queue/queue.constants';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { OrdersController } from './controllers/orders.controller';
import { OrderEntity } from './entities/order.entity';
import { OrderPersistenceProcessor } from './processors/order-persistence.processor';
import { OrderCacheRepository } from './repositories/order-cache.repository';
import { OrdersRepository } from './repositories/orders.repository';
import { OrderPersistenceService } from './services/order-persistence.service';
import { OrdersService } from './services/orders.service';

@Module({
  imports: [
    RedisModule,
    BullModule.registerQueue({ name: ORDER_PERSISTENCE_QUEUE }),
    TypeOrmModule.forFeature([OrderEntity]),
  ],
  controllers: [OrdersController],
  providers: [
    OrdersRepository,
    OrderCacheRepository,
    OrdersService,
    OrderPersistenceService,
    OrderPersistenceProcessor,
  ],
  exports: [OrdersService, OrderPersistenceService],
})
export class OrdersModule {}
