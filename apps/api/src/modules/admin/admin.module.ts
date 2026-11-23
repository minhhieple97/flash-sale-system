import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { FlashSalesModule } from '../flash-sales/flash-sales.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { SaleLedgerModule } from '../sale-ledger';
import {
  LEDGER_MAINTENANCE_INTERVAL,
  LEDGER_MAINTENANCE_INTERVAL_MS,
} from './constants/admin.constants';
import { AdminFlashSaleController } from './controllers/admin-flash-sale.controller';
import { AdminEndpointsGuard } from './guards/admin-endpoints.guard';
import { FlashSaleHydrationService } from './services/flash-sale-hydration.service';
import { FlashSaleResetService } from './services/flash-sale-reset.service';
import { LedgerMaintenanceService } from './services/ledger-maintenance.service';

@Module({
  imports: [CommonModule, ProductsModule, FlashSalesModule, OrdersModule, SaleLedgerModule],
  controllers: [AdminFlashSaleController],
  providers: [
    FlashSaleHydrationService,
    FlashSaleResetService,
    LedgerMaintenanceService,
    AdminEndpointsGuard,
    { provide: LEDGER_MAINTENANCE_INTERVAL, useValue: LEDGER_MAINTENANCE_INTERVAL_MS },
  ],
})
export class AdminModule {}
