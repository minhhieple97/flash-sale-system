import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import type { Product } from '../interfaces/product.interface';

function toProduct(row: ProductEntity): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    originalPriceCents: row.originalPriceCents,
    salePriceCents: row.salePriceCents,
    imageUrl: row.imageUrl,
  };
}

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(ProductEntity) private readonly products: Repository<ProductEntity>,
  ) {}

  async findById(productId: string): Promise<Product | null> {
    const row = await this.products.findOneBy({ id: productId });
    return row ? toProduct(row) : null;
  }
}
