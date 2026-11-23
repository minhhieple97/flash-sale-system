import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import type { Product } from '../products.types';

const INSERT_PRODUCT_IF_ABSENT_SQL = `
  INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (id) DO NOTHING`;

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

  async insertIfAbsent(product: Product): Promise<void> {
    await this.products.query(INSERT_PRODUCT_IF_ABSENT_SQL, [
      product.id,
      product.sku,
      product.name,
      product.description,
      product.originalPriceCents,
      product.salePriceCents,
      product.imageUrl,
    ]);
  }
}
