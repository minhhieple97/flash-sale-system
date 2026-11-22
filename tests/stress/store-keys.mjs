// The stress suite is a black-box tool, so it cannot import the API's TypeScript constants.
// These mirror the Redis wire format in one place; keep this file free of Node built-ins.
export const CONFIRMED_STATUS = 'CONFIRMED';
export const CONFIRMED_PREFIX = `${CONFIRMED_STATUS}:`;

export const stockKey = (saleId) => `flash_sale:{${saleId}}:stock`;
export const usersKey = (saleId) => `flash_sale:{${saleId}}:users`;
