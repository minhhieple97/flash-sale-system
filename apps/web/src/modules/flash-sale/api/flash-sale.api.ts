import { requestJson } from '@/shared/api/http-client';
import type { HttpResult } from '@/shared/types/api.types';
import { CURRENT_FLASH_SALE_PATH } from '../constants/flash-sale.constants';
import type { FlashSaleStatus } from '../types/flash-sale.types';

export function fetchCurrentFlashSale(signal?: AbortSignal): Promise<HttpResult<FlashSaleStatus>> {
  return requestJson<FlashSaleStatus>({ path: CURRENT_FLASH_SALE_PATH, signal });
}
