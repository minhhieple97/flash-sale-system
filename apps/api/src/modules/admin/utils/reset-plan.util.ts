import { BadRequestException } from '@nestjs/common';
import type { SaleWindowConfig } from '../../flash-sales/interfaces/flash-sale.interface';
import { MS_PER_SECOND } from '../constants/admin.constants';
import type { ResetFlashSaleInput, ResetFlashSalePlan } from '../interfaces/admin.interface';

type WindowMs = Pick<SaleWindowConfig, 'startsAtMs' | 'endsAtMs'>;

function hasAbsoluteFields(input: ResetFlashSaleInput): boolean {
  return input.startsAt !== undefined || input.endsAt !== undefined;
}

function hasRelativeFields(input: ResetFlashSaleInput): boolean {
  return input.startsOffsetSeconds !== undefined || input.durationSeconds !== undefined;
}

function absoluteWindow(input: ResetFlashSaleInput, configured: SaleWindowConfig): WindowMs {
  const startsAtMs =
    input.startsAt === undefined ? configured.startsAtMs : Date.parse(input.startsAt);
  const endsAtMs =
    input.endsAt === undefined
      ? startsAtMs + (configured.endsAtMs - configured.startsAtMs)
      : Date.parse(input.endsAt);
  if (endsAtMs <= startsAtMs) throw new BadRequestException('endsAt must be after startsAt');
  return { startsAtMs, endsAtMs };
}

function relativeWindow(
  input: ResetFlashSaleInput,
  nowMs: number,
  configured: SaleWindowConfig,
): WindowMs {
  const startsAtMs = nowMs + (input.startsOffsetSeconds ?? 0) * MS_PER_SECOND;
  const durationMs =
    input.durationSeconds === undefined
      ? configured.endsAtMs - configured.startsAtMs
      : input.durationSeconds * MS_PER_SECOND;
  return { startsAtMs, endsAtMs: startsAtMs + durationMs };
}

function resolveWindow(
  input: ResetFlashSaleInput,
  nowMs: number,
  configured: SaleWindowConfig,
): WindowMs {
  if (hasAbsoluteFields(input) && hasRelativeFields(input)) {
    throw new BadRequestException(
      'startsAt/endsAt cannot be combined with startsOffsetSeconds/durationSeconds',
    );
  }
  if (hasAbsoluteFields(input)) return absoluteWindow(input, configured);
  if (hasRelativeFields(input)) return relativeWindow(input, nowMs, configured);
  return configured;
}

export function resolveResetPlan(
  input: ResetFlashSaleInput,
  nowMs: number,
  configured: SaleWindowConfig,
): ResetFlashSalePlan {
  const { startsAtMs, endsAtMs } = resolveWindow(input, nowMs, configured);
  return {
    totalStock: input.totalStock ?? configured.totalStock,
    startsAtMs,
    endsAtMs,
  };
}
