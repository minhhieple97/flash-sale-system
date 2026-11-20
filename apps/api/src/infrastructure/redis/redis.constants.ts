export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_CLOSED_STATUS = 'end';
export const flashSaleConfigKey = (saleId: string): string => `flash_sale:${saleId}:config`;
export const flashSaleStockKey = (saleId: string): string => `flash_sale:${saleId}:stock`;
export const flashSaleUsersKey = (saleId: string): string => `flash_sale:${saleId}:users`;
export const FLASH_SALE_CONFIG_FIELDS = {
  saleId: 'saleId',
  productId: 'productId',
  productName: 'productName',
  salePriceCents: 'salePriceCents',
  originalPriceCents: 'originalPriceCents',
  totalStock: 'totalStock',
  startTimeMs: 'startTimeMs',
  endTimeMs: 'endTimeMs',
} as const;
