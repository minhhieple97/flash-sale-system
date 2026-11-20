import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { FlashSalesController } from './controllers/flash-sales.controller';
import { FlashSaleEntity } from './entities/flash-sale.entity';
import { FlashSaleCacheRepository } from './repositories/flash-sale-cache.repository';
import { FlashSalesRepository } from './repositories/flash-sales.repository';
import { FlashSalesService } from './services/flash-sales.service';

@Module({
  imports: [CommonModule, RedisModule, TypeOrmModule.forFeature([FlashSaleEntity])],
  controllers: [FlashSalesController],
  providers: [FlashSalesRepository, FlashSaleCacheRepository, FlashSalesService],
})
export class FlashSalesModule {}
