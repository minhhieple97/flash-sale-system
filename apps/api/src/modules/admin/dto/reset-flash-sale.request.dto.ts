import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import {
  MAX_PRODUCT_NAME_LENGTH,
  MAX_RESET_DURATION_SECONDS,
  MAX_RESET_OFFSET_SECONDS,
  MAX_RESET_TOTAL_STOCK,
  MIN_PRODUCT_NAME_LENGTH,
  MIN_RESET_DURATION_SECONDS,
  MIN_RESET_TOTAL_STOCK,
} from '../constants/admin.constants';
import type { ResetFlashSaleInput } from '../interfaces/admin.interface';

export class ResetFlashSaleRequestDto implements ResetFlashSaleInput {
  @IsOptional()
  @IsInt()
  @Min(MIN_RESET_TOTAL_STOCK)
  @Max(MAX_RESET_TOTAL_STOCK)
  totalStock?: number;

  /** Negative values open the window in the past (e.g. the "Ended Sale" preset). */
  @IsOptional()
  @IsInt()
  @Min(-MAX_RESET_OFFSET_SECONDS)
  @Max(MAX_RESET_OFFSET_SECONDS)
  startsOffsetSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_RESET_DURATION_SECONDS)
  @Max(MAX_RESET_DURATION_SECONDS)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  @Length(MIN_PRODUCT_NAME_LENGTH, MAX_PRODUCT_NAME_LENGTH)
  productName?: string;
}
