import { Controller, Get } from '@nestjs/common';
import { CURRENT_FLASH_SALE_ROUTE, FLASH_SALES_ROUTE } from '../constants/flash-sales.constants';
import { FlashSaleStatusResponseDto } from '../dto/flash-sale-status.response.dto';
import { FlashSalesService } from '../services/flash-sales.service';

@Controller(FLASH_SALES_ROUTE)
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Get(CURRENT_FLASH_SALE_ROUTE)
  async getCurrent(): Promise<FlashSaleStatusResponseDto> {
    return FlashSaleStatusResponseDto.from(await this.flashSalesService.getCurrentStatus());
  }
}
