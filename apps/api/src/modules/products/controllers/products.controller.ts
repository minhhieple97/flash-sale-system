import { Controller, Get } from '@nestjs/common';
import { FEATURED_PRODUCT_ROUTE, PRODUCTS_ROUTE } from '../constants/products.constants';
import { ProductResponseDto } from '../dto/product.response.dto';
import { ProductsService } from '../services/products.service';

@Controller(PRODUCTS_ROUTE)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get(FEATURED_PRODUCT_ROUTE)
  async getFeatured(): Promise<ProductResponseDto> {
    return ProductResponseDto.from(await this.productsService.getFeaturedProduct());
  }
}
