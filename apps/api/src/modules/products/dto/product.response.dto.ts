import type { Product } from '../interfaces/product.interface';

export class ProductResponseDto {
  id!: string;
  sku!: string;
  name!: string;
  description!: string;
  originalPriceCents!: number;
  salePriceCents!: number;
  imageUrl!: string | null;

  static from(product: Product): ProductResponseDto {
    return Object.assign(new ProductResponseDto(), {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      originalPriceCents: product.originalPriceCents,
      salePriceCents: product.salePriceCents,
      imageUrl: product.imageUrl,
    });
  }
}
