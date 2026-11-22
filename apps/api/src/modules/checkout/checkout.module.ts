import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OrdersCoreModule } from '../orders/orders.module';
import { SaleLedgerModule } from '../sale-ledger';
import { CheckoutController } from './controllers/checkout.controller';
import { CheckoutService } from './services/checkout.service';

@Module({
  imports: [CommonModule, SaleLedgerModule, OrdersCoreModule, MetricsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
