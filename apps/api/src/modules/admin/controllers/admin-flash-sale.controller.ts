import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { FlashSaleStatusResponseDto } from '../../flash-sales/dto/flash-sale-status.response.dto';
import {
  ADMIN_FLASH_SALES_ROUTE,
  RESET_ROUTE,
  RESET_VALIDATION_OPTIONS,
} from '../constants/admin.constants';
import { ResetFlashSaleRequestDto } from '../dto/reset-flash-sale.request.dto';
import { AdminEndpointsGuard } from '../guards/admin-endpoints.guard';
import { FlashSaleResetService } from '../services/flash-sale-reset.service';

@Controller(ADMIN_FLASH_SALES_ROUTE)
@UseGuards(AdminEndpointsGuard)
export class AdminFlashSaleController {
  constructor(private readonly resetService: FlashSaleResetService) {}

  @Post(RESET_ROUTE)
  @HttpCode(HttpStatus.OK)
  async reset(
    @Body(new ValidationPipe(RESET_VALIDATION_OPTIONS)) body: ResetFlashSaleRequestDto,
  ): Promise<FlashSaleStatusResponseDto> {
    return FlashSaleStatusResponseDto.from(await this.resetService.reset(body));
  }
}
