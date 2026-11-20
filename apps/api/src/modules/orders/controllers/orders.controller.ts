import { Controller, Get, Param } from '@nestjs/common';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import { NormalizedUserIdPipe } from '../../../common/pipes/normalized-user-id.pipe';
import { ORDERS_ROUTE, USER_ID_PARAM, USER_ORDER_ROUTE } from '../constants/orders.constants';
import { OrderStatusResponseDto } from '../dto/order-status.response.dto';
import { OrdersService } from '../services/orders.service';

@Controller(ORDERS_ROUTE)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** `OrderStatusResponseDto.from(await ordersService.getUserOrderStatus(userId))`. */
  @Get(USER_ORDER_ROUTE)
  async getUserOrder(
    @Param(USER_ID_PARAM, NormalizedUserIdPipe) userId: NormalizedUserId,
  ): Promise<OrderStatusResponseDto> {
    return OrderStatusResponseDto.from(await this.ordersService.getUserOrderStatus(userId));
  }
}
