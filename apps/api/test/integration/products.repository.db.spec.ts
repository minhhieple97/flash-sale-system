import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { ProductEntity } from '../../src/modules/products/entities/product.entity';
import type { Product } from '../../src/modules/products/products.types';
import { ProductsRepository } from '../../src/modules/products/repositories/products.repository';

describe('ProductsRepository', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repository: ProductsRepository;
  const insertedIds: string[] = [];

  async function insertProduct(imageUrl: string | null): Promise<string> {
    const id = randomUUID();
    insertedIds.push(id);
    await dataSource.query(
      `INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents, image_url)
       VALUES ($1, $2, 'Phone', 'A phone', 1000, 500, $3)`,
      [id, randomUUID(), imageUrl],
    );
    return id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule, TypeOrmModule.forFeature([ProductEntity])],
      providers: [ProductsRepository],
    }).compile();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
    repository = moduleRef.get(ProductsRepository);
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM products WHERE id = ANY($1)', [insertedIds]);
    await moduleRef.close();
  });

  it('maps a row to a Product with numeric prices and a null image', async () => {
    const id = await insertProduct(null);

    const product = await repository.findById(id);

    expect(product).toEqual({
      id,
      sku: expect.any(String),
      name: 'Phone',
      description: 'A phone',
      originalPriceCents: 1000,
      salePriceCents: 500,
      imageUrl: null,
    });
  });

  it('keeps a present image url', async () => {
    const id = await insertProduct('https://img.test/a.png');

    const product = await repository.findById(id);

    expect(product?.imageUrl).toBe('https://img.test/a.png');
  });

  it('maps an unknown id to null', async () => {
    await expect(repository.findById(randomUUID())).resolves.toBeNull();
  });

  describe('insertIfAbsent', () => {
    function productWith(id: string, name: string): Product {
      insertedIds.push(id);
      return {
        id,
        sku: randomUUID(),
        name,
        description: 'seeded',
        originalPriceCents: 2000,
        salePriceCents: 900,
        imageUrl: null,
      };
    }

    it('inserts the product when its id is missing', async () => {
      const product = productWith(randomUUID(), 'Seeded');

      await repository.insertIfAbsent(product);

      await expect(repository.findById(product.id)).resolves.toEqual(product);
    });

    it('leaves an existing row unchanged when the id already exists', async () => {
      const original = productWith(randomUUID(), 'Original');
      await repository.insertIfAbsent(original);
      const conflicting = { ...productWith(original.id, 'Overwrite'), sku: randomUUID() };

      await repository.insertIfAbsent(conflicting);

      await expect(repository.findById(original.id)).resolves.toEqual(original);
    });
  });
});
