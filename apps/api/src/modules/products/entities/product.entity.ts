import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'products' })
export class ProductEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'original_price_cents', type: 'int' })
  originalPriceCents!: number;

  @Column({ name: 'sale_price_cents', type: 'int' })
  salePriceCents!: number;

  @Column({ name: 'image_url', type: 'varchar', length: 512, nullable: true })
  imageUrl!: string | null;
}
