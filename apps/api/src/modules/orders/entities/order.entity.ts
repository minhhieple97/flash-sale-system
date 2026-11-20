import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'orders' })
export class OrderEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'flash_sale_id', type: 'uuid' })
  flashSaleId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 128 })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;
}
