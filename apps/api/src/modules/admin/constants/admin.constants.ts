import type { ValidationPipeOptions } from '@nestjs/common';
import { MAX_SALE_TOTAL_STOCK } from '../../../common/constants/common.constants';
import type { MaintenanceIntervalMs } from '../interfaces/admin.interface';

export const ADMIN_FLASH_SALES_ROUTE = 'admin/flash-sales';
export const RESET_ROUTE = 'reset';

export const MS_PER_SECOND = 1000;

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
export const MIN_RESET_TOTAL_STOCK = 0;
export const MAX_RESET_TOTAL_STOCK = MAX_SALE_TOTAL_STOCK;
export const MAX_RESET_OFFSET_SECONDS = SECONDS_PER_YEAR;
export const MIN_RESET_DURATION_SECONDS = 1;
export const MAX_RESET_DURATION_SECONDS = SECONDS_PER_YEAR;

/** A missing body validates as `{}`; unknown fields are a 400. */
export const RESET_VALIDATION_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

export const ADMIN_ENDPOINTS_DISABLED_MESSAGE = 'Not found';

export const LEDGER_MAINTENANCE_INTERVAL_MS = 30_000;
export const MAINTENANCE_LEASE_TTL_MS = 25_000;
export const BOOT_LEASE_RETRY_MS = 100;
export const BOOT_LEASE_MAX_ATTEMPTS = 50;
export const RESET_LEASE_RETRY_MS = 100;
export const RESET_LEASE_MAX_ATTEMPTS = 20;
export const LEDGER_MAINTENANCE_INTERVAL = Symbol('LEDGER_MAINTENANCE_INTERVAL');
export const BOOTSTRAP_SWEEP_TRIGGER = Symbol('BOOTSTRAP_SWEEP_TRIGGER');
export const MAINTENANCE_DISABLED: MaintenanceIntervalMs = null;
