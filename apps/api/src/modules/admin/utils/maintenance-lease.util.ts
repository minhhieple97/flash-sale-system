import { randomUUID } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type { SaleLedgerLeaseRepository } from '../../sale-ledger';
import { MAINTENANCE_LEASE_TTL_MS } from '../constants/admin.constants';

export interface LeaseRetryOptions {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
}

const NO_RETRY: LeaseRetryOptions = { maxAttempts: 1, retryDelayMs: 0 };

async function tryAcquireLease(
  leases: SaleLedgerLeaseRepository,
  ownerToken: string,
  options: LeaseRetryOptions,
): Promise<boolean> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const acquired = await leases.acquireMaintenanceLease({
      saleId: ACTIVE_FLASH_SALE_ID,
      ownerToken,
      ttlMs: MAINTENANCE_LEASE_TTL_MS,
    });
    if (acquired) return true;
    if (attempt < options.maxAttempts && options.retryDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, options.retryDelayMs));
    }
  }
  return false;
}

async function releaseLeaseSafely(
  leases: SaleLedgerLeaseRepository,
  ownerToken: string,
  logger: Logger,
): Promise<void> {
  try {
    await leases.releaseMaintenanceLease(ACTIVE_FLASH_SALE_ID, ownerToken);
  } catch (error: unknown) {
    logger.warn(
      `Failed to release maintenance lease of sale ${ACTIVE_FLASH_SALE_ID}: ${String(error)}`,
    );
  }
}

export async function runWithMaintenanceLease<T>(params: {
  leases: SaleLedgerLeaseRepository;
  logger: Logger;
  retry?: LeaseRetryOptions;
  run: () => Promise<T>;
}): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const ownerToken = randomUUID();
  const acquired = await tryAcquireLease(params.leases, ownerToken, params.retry ?? NO_RETRY);
  if (!acquired) return { acquired: false };
  try {
    return { acquired: true, value: await params.run() };
  } finally {
    await releaseLeaseSafely(params.leases, ownerToken, params.logger);
  }
}
