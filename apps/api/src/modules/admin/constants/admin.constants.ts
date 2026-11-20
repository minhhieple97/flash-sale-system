import type { ValidationPipeOptions } from '@nestjs/common';

export const ADMIN_FLASH_SALES_ROUTE = 'admin/flash-sales';
export const RESET_ROUTE = 'reset';

export const MS_PER_SECOND = 1000;
export const DEFAULT_RESET_STARTS_OFFSET_SECONDS = 0;
/** Other reset defaults reuse DEFAULT_CAMPAIGN_TOTAL_STOCK / DEFAULT_CAMPAIGN_DURATION_MS. */

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
export const MIN_RESET_TOTAL_STOCK = 0;
export const MAX_RESET_TOTAL_STOCK = 1_000_000;
export const MAX_RESET_OFFSET_SECONDS = SECONDS_PER_YEAR;
export const MIN_RESET_DURATION_SECONDS = 1;
export const MAX_RESET_DURATION_SECONDS = SECONDS_PER_YEAR;
export const MIN_PRODUCT_NAME_LENGTH = 1;
export const MAX_PRODUCT_NAME_LENGTH = 255;

/** A missing body validates as `{}`; unknown fields are a 400. */
export const RESET_VALIDATION_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

export const ADMIN_ENDPOINTS_DISABLED_MESSAGE = 'Not found';
