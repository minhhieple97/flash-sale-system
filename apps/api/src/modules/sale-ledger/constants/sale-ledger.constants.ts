export const SALE_LEDGER_REDIS = Symbol('SALE_LEDGER_REDIS');

export const flashSaleConfigKey = (saleId: string): string => `flash_sale:{${saleId}}:config`;
export const flashSaleStockKey = (saleId: string): string => `flash_sale:{${saleId}}:stock`;
export const flashSaleUsersKey = (saleId: string): string => `flash_sale:{${saleId}}:users`;
export const flashSaleMaintenanceLockKey = (saleId: string): string =>
  `flash_sale:{${saleId}}:maintenance_lock`;

export const SALE_CONFIG_FIELDS = {
  saleId: 'saleId',
  totalStock: 'totalStock',
  startTimeMs: 'startTimeMs',
  endTimeMs: 'endTimeMs',
} as const;

export const RESERVATION_ENTRY_PREFIX = { RESERVED: 'RESERVED:', CONFIRMED: 'CONFIRMED:' } as const;

export const ATTEMPT_PURCHASE_KEY_COUNT = 3;

export const ROLLBACK_PURCHASE_KEY_COUNT = 2;
export const ROLLBACK_PURCHASE_REPLY = { RELEASED: 1, NOT_RESERVED: 0 } as const;

export const CONFIRM_PURCHASE_KEY_COUNT = 1;
export const CONFIRM_PURCHASE_REPLY = { CONFIRMED: 1, NOT_RESERVED: 0 } as const;

export const ADOPT_ORDER_KEY_COUNT = 2;
export const ADOPT_ORDER_REPLY = { ADOPTED: 1, NOT_ADOPTED: 0 } as const;

export const RESTORE_SALE_KEY_COUNT = 3;
export const RESTORE_SALE_REPLY = { HYDRATED: 1, ALREADY_PRESENT: 0 } as const;

export const HYDRATION_BATCH_SIZE = 1_000;

export const RESTORE_CONFIRMED_BATCH_KEY_COUNT = 1;
export const RESTORE_CONFIRMED_BATCH_REPLY = { WROTE: 1, NOOP: 0 } as const;

export const RELEASE_LOCK_KEY_COUNT = 1;
export const RELEASE_LOCK_REPLY = { RELEASED: 1, NOT_OWNER: 0 } as const;

export const RESERVATION_SCAN_COUNT = 500;
