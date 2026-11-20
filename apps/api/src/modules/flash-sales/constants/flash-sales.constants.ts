export const ACTIVE_FLASH_SALE_ID = '00000000-0000-4000-8000-000000000001';
export const FLASH_SALE_STATUS_CACHE_TTL_MS = 200;
/** Seeded campaign on boot, also the admin reset defaults. */
export const DEFAULT_CAMPAIGN_TOTAL_STOCK = 100;
export const DEFAULT_CAMPAIGN_DURATION_MS = 24 * 60 * 60 * 1000;
export const FLASH_SALE_ERROR_CODES = { FLASH_SALE_NOT_FOUND: 'FLASH_SALE_NOT_FOUND' } as const;
export const FLASH_SALE_NOT_FOUND_MESSAGE = 'No flash sale is currently configured';
export const FLASH_SALES_ROUTE = 'flash-sales';
export const CURRENT_FLASH_SALE_ROUTE = 'current';
