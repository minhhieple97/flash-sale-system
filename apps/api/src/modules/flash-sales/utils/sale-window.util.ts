import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../../config/env.interface';
import { SALE_WINDOW_DEFAULTS } from '../constants/flash-sales.constants';
import type {
  ExplicitSaleConfig,
  FlashSaleCampaign,
  SaleWindowConfig,
} from '../interfaces/flash-sale.interface';

export type SaleWindowEnv = Pick<AppEnv, 'SALE_STARTS_AT' | 'SALE_ENDS_AT' | 'SALE_TOTAL_STOCK'>;

/**
 * ConfigService.get falls back to the raw process.env, where compose passes an unset variable
 * through as an empty string; the validated config already maps that to undefined.
 */
export function readSaleWindowEnv(config: ConfigService<AppEnv, true>): SaleWindowEnv {
  const raw = {
    SALE_STARTS_AT: config.get('SALE_STARTS_AT', { infer: true }),
    SALE_ENDS_AT: config.get('SALE_ENDS_AT', { infer: true }),
    SALE_TOTAL_STOCK: config.get('SALE_TOTAL_STOCK', { infer: true }),
  };
  return {
    SALE_STARTS_AT: raw.SALE_STARTS_AT || undefined,
    SALE_ENDS_AT: raw.SALE_ENDS_AT || undefined,
    SALE_TOTAL_STOCK: (raw.SALE_TOTAL_STOCK as unknown) === '' ? undefined : raw.SALE_TOTAL_STOCK,
  };
}

export function parseExplicitSaleConfig(env: SaleWindowEnv): ExplicitSaleConfig {
  const { SALE_STARTS_AT: startsAt, SALE_ENDS_AT: endsAt, SALE_TOTAL_STOCK: totalStock } = env;
  const explicit: ExplicitSaleConfig = {};
  if (startsAt !== undefined && endsAt !== undefined) {
    explicit.window = { startsAtMs: Date.parse(startsAt), endsAtMs: Date.parse(endsAt) };
  }
  if (totalStock !== undefined) explicit.totalStock = totalStock;
  return explicit;
}

export function resolveSaleWindow(explicit: ExplicitSaleConfig, nowMs: number): SaleWindowConfig {
  const window = explicit.window ?? {
    startsAtMs: nowMs,
    endsAtMs: nowMs + SALE_WINDOW_DEFAULTS.durationMs,
  };
  return { ...window, totalStock: explicit.totalStock ?? SALE_WINDOW_DEFAULTS.totalStock };
}

export function applyExplicitSaleConfig(
  stored: FlashSaleCampaign,
  explicit: ExplicitSaleConfig,
): SaleWindowConfig {
  const window = explicit.window ?? {
    startsAtMs: stored.startsAt.getTime(),
    endsAtMs: stored.endsAt.getTime(),
  };
  return { ...window, totalStock: explicit.totalStock ?? stored.totalStock };
}

export function matchesSaleWindow(campaign: FlashSaleCampaign, window: SaleWindowConfig): boolean {
  return (
    campaign.startsAt.getTime() === window.startsAtMs &&
    campaign.endsAt.getTime() === window.endsAtMs &&
    campaign.totalStock === window.totalStock
  );
}
