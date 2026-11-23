import { Module } from '@nestjs/common';
import { ProductsController } from './controllers/products.controller';
import { ProductsCoreModule } from './products-core.module';

@Module({
  imports: [ProductsCoreModule],
  controllers: [ProductsController],
  exports: [ProductsCoreModule],
})
export class ProductsModule {}
