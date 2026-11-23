import { Module } from '@nestjs/common';
import { FlashSalesController } from './controllers/flash-sales.controller';
import { FlashSalesCoreModule } from './flash-sales-core.module';

@Module({
  imports: [FlashSalesCoreModule],
  controllers: [FlashSalesController],
  exports: [FlashSalesCoreModule],
})
export class FlashSalesModule {}
