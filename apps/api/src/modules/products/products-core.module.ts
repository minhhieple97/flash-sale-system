import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { ProductEntity } from './entities/product.entity';
import { ProductsRepository } from './repositories/products.repository';
import { ProductsService } from './services/products.service';

@Module({
  imports: [CommonModule, TypeOrmModule.forFeature([ProductEntity])],
  providers: [ProductsRepository, ProductsService],
  exports: [ProductsService],
})
export class ProductsCoreModule {}
