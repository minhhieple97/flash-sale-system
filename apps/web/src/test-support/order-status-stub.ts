import { jsonResponse } from './fetch-stub';

export interface OrderStatusBody {
  userId: string;
  hasPurchased: boolean;
  status: 'NONE' | 'RESERVED' | 'CONFIRMED';
  orderId: string | null;
}

export function orderStatusBody(
  status: OrderStatusBody['status'],
  userId: string,
  orderId: string | null,
): OrderStatusBody {
  const hasOrder = status !== 'NONE';
  return { userId, hasPurchased: hasOrder, status, orderId: hasOrder ? orderId : null };
}

export function orderStatusResponse(
  status: OrderStatusBody['status'],
  userId: string,
  orderId: string | null = 'order-123',
): Response {
  return jsonResponse(200, orderStatusBody(status, userId, orderId));
}
