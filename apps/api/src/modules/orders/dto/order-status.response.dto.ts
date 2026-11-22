import type { OrderState, UserOrderStatus } from '../interfaces/order.interface';

/** 200 body of GET /api/v1/orders/user/:userId. `hasPurchased` is `status !== 'NONE'`. */
export class OrderStatusResponseDto {
  userId!: string;
  hasPurchased!: boolean;
  status!: OrderState;
  orderId!: string | null;

  static from(status: UserOrderStatus): OrderStatusResponseDto {
    const dto = new OrderStatusResponseDto();
    dto.userId = status.userId;
    dto.hasPurchased = status.status !== 'NONE';
    dto.status = status.status;
    dto.orderId = status.status === 'NONE' ? null : status.orderId;
    return dto;
  }
}
