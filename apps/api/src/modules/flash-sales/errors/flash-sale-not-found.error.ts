import { NotFoundException } from '@nestjs/common';
import {
  FLASH_SALE_ERROR_CODES,
  FLASH_SALE_NOT_FOUND_MESSAGE,
} from '../constants/flash-sales.constants';

export const flashSaleNotFound = (): NotFoundException =>
  new NotFoundException({
    code: FLASH_SALE_ERROR_CODES.FLASH_SALE_NOT_FOUND,
    message: FLASH_SALE_NOT_FOUND_MESSAGE,
  });
