import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { FlashSalesModule } from '../flash-sales/flash-sales.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { AdminFlashSaleController } from './controllers/admin-flash-sale.controller';
import { AdminEndpointsGuard } from './guards/admin-endpoints.guard';
import { FlashSaleHydrationService } from './services/flash-sale-hydration.service';
import { FlashSaleResetService } from './services/flash-sale-reset.service';

/** Top of the DAG: ADMIN -> PROD, FS, ORD. ConfigService comes from the global AppConfigModule. */
@Module({
  imports: [CommonModule, ProductsModule, FlashSalesModule, OrdersModule],
  controllers: [AdminFlashSaleController],
  providers: [FlashSaleHydrationService, FlashSaleResetService, AdminEndpointsGuard],
})
export class AdminModule {}
