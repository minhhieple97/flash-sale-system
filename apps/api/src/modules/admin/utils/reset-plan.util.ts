import {
  DEFAULT_CAMPAIGN_DURATION_MS,
  DEFAULT_CAMPAIGN_TOTAL_STOCK,
} from '../../flash-sales/constants/flash-sales.constants';
import { DEFAULT_RESET_STARTS_OFFSET_SECONDS, MS_PER_SECOND } from '../constants/admin.constants';
import type { ResetFlashSaleInput, ResetFlashSalePlan } from '../interfaces/admin.interface';

/** Defaults apply only to absent fields, so an explicit 0 stock or 0 offset is kept. */
export function resolveResetPlan(input: ResetFlashSaleInput, nowMs: number): ResetFlashSalePlan {
  const offsetSeconds = input.startsOffsetSeconds ?? DEFAULT_RESET_STARTS_OFFSET_SECONDS;
  const startsAtMs = nowMs + offsetSeconds * MS_PER_SECOND;
  const durationMs =
    input.durationSeconds === undefined
      ? DEFAULT_CAMPAIGN_DURATION_MS
      : input.durationSeconds * MS_PER_SECOND;
  return {
    totalStock: input.totalStock ?? DEFAULT_CAMPAIGN_TOTAL_STOCK,
    startsAtMs,
    endsAtMs: startsAtMs + durationMs,
    productName: input.productName ?? null,
  };
}
