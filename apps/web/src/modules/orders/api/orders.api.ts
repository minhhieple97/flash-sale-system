import { requestJson } from '@/shared/api/http-client';
import type { HttpResult } from '@/shared/types/common.types';
import { orderStatusPath } from '../constants/orders.constants';
import type { OrderStatus } from '../types/orders.types';

export function fetchOrderStatus(
  userId: string,
  signal?: AbortSignal,
): Promise<HttpResult<OrderStatus>> {
  return requestJson<OrderStatus>({ path: orderStatusPath(userId), signal });
}
