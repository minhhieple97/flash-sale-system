import type { FlashSaleStatus } from '@/modules/flash-sale';
import { requestJson } from '@/shared/api/http-client';
import type { HttpResult } from '@/shared/types/api.types';
import { ADMIN_KEY_HEADER, RESET_FLASH_SALE_PATH } from '../constants/simulation.constants';
import type { ResetFlashSalePayload } from '../types/simulation.types';

export function resetFlashSale(
  payload: ResetFlashSalePayload,
  adminKey?: string,
): Promise<HttpResult<FlashSaleStatus>> {
  const headers = adminKey ? { [ADMIN_KEY_HEADER]: adminKey } : undefined;
  return requestJson<FlashSaleStatus>({
    path: RESET_FLASH_SALE_PATH,
    method: 'POST',
    body: payload,
    headers,
  });
}
