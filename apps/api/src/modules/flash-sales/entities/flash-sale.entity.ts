import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'flash_sales' })
export class FlashSaleEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'total_stock', type: 'int' })
  totalStock!: number;

  @Column({ name: 'remaining_stock', type: 'int' })
  remainingStock!: number;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;
}
