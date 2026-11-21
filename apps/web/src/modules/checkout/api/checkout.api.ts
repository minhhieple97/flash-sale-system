import { requestJson } from '@/shared/api/http-client';
import type { HttpResult } from '@/shared/types/api.types';
import { PURCHASE_PATH } from '../constants/checkout.constants';
import type { PurchaseReservedBody } from '../types/checkout.types';

export function submitPurchase(userId: string): Promise<HttpResult<PurchaseReservedBody>> {
  return requestJson<PurchaseReservedBody>({
    path: PURCHASE_PATH,
    method: 'POST',
    body: { userId },
  });
}
