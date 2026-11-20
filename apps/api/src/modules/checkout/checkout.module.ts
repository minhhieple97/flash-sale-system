import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { OrdersModule } from '../orders/orders.module';
import { CheckoutController } from './controllers/checkout.controller';
import { CheckoutGatekeeperRepository } from './repositories/checkout-gatekeeper.repository';
import { CheckoutService } from './services/checkout.service';

/** CHK -> ORD -> (types of) FS; nothing imports Checkout. */
@Module({
  imports: [CommonModule, RedisModule, OrdersModule],
  controllers: [CheckoutController],
  providers: [CheckoutGatekeeperRepository, CheckoutService],
})
export class CheckoutModule {}
