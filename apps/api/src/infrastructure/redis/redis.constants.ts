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

/**
 * Wire format of a `flash_sale:{saleId}:users` value: `<prefix><orderId>`.
 * Readers: the Lua sources in ./lua and order-cache.repository.ts only. Every layer above the
 * repositories sees a `ReservationSlot` domain object instead.
 */
export const RESERVATION_ENTRY_PREFIX = { RESERVED: 'RESERVED:', CONFIRMED: 'CONFIRMED:' } as const;

/** attemptPurchase: KEYS config, stock, users; ARGV userId, nowMs, orderId. */
export const ATTEMPT_PURCHASE_KEY_COUNT = 3;
export const ATTEMPT_PURCHASE_REPLY = {
  RESERVED: 'RESERVED',
  ALREADY_PURCHASED: 'ALREADY_PURCHASED',
  SOLD_OUT: 'SOLD_OUT',
  SALE_UPCOMING: 'SALE_UPCOMING',
  SALE_ENDED: 'SALE_ENDED',
  SALE_NOT_CONFIGURED: 'SALE_NOT_CONFIGURED',
} as const;

/** rollbackPurchase: KEYS stock, users; ARGV userId, orderId the entry must still hold. */
export const ROLLBACK_PURCHASE_KEY_COUNT = 2;
export const ROLLBACK_PURCHASE_REPLY = { RELEASED: 1, NOT_RESERVED: 0 } as const;
