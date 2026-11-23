import { Controller, Get, Header } from '@nestjs/common';
import {
  FEATURED_PRODUCT_CACHE_CONTROL,
  FEATURED_PRODUCT_ROUTE,
  PRODUCTS_ROUTE,
  ProductResponseDto,
} from '../products.types';
import { ProductsService } from '../services/products.service';

@Controller(PRODUCTS_ROUTE)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get(FEATURED_PRODUCT_ROUTE)
  @Header('Cache-Control', FEATURED_PRODUCT_CACHE_CONTROL)
  async getFeatured(): Promise<ProductResponseDto> {
    return ProductResponseDto.from(await this.productsService.getFeaturedProduct());
  }
}
