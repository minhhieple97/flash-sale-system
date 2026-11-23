import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OrdersModule } from '../orders/orders.module';
import { SaleLedgerModule } from '../sale-ledger';
import { CheckoutController } from './controllers/checkout.controller';
import { CheckoutService } from './services/checkout.service';

@Module({
  imports: [CommonModule, SaleLedgerModule, OrdersModule, MetricsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
