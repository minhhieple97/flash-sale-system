import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { FlashSaleEntity } from '../../src/modules/flash-sales/entities/flash-sale.entity';
import { FlashSalesRepository } from '../../src/modules/flash-sales/repositories/flash-sales.repository';

const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';

describe('FlashSalesRepository', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repository: FlashSalesRepository;
  const productId = randomUUID();
  const saleId = randomUUID();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule, TypeOrmModule.forFeature([FlashSaleEntity])],
      providers: [FlashSalesRepository],
    }).compile();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
    repository = moduleRef.get(FlashSalesRepository);
    await dataSource.query(
      `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents)
       VALUES ($1, $2, 'n', 'd', 100, 50)`,
      [productId, randomUUID()],
    );
    await dataSource.query(
      `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at)
       VALUES ($1, $2, 10, 4, $3, $4)`,
      [saleId, productId, STARTS_AT, ENDS_AT],
    );
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM flash_sales WHERE id = $1', [saleId]);
    await dataSource.query('DELETE FROM products WHERE id = $1', [productId]);
    await moduleRef.close();
  });

  it('maps a row to a FlashSaleCampaign with Date fields', async () => {
    const campaign = await repository.findById(saleId);

    expect(campaign).toEqual({
      id: saleId,
      productId,
      totalStock: 10,
      remainingStock: 4,
      startsAt: new Date(STARTS_AT),
      endsAt: new Date(ENDS_AT),
    });
  });

  it('maps an unknown id to null', async () => {
    await expect(repository.findById(randomUUID())).resolves.toBeNull();
  });
});
