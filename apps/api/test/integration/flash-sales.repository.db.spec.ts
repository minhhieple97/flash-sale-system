import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/infrastructure/database/database.module';
import { FlashSaleEntity } from '../../src/modules/flash-sales/entities/flash-sale.entity';
import type { FlashSaleCampaign } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import { FlashSalesRepository } from '../../src/modules/flash-sales/repositories/flash-sales.repository';

const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';

describe('FlashSalesRepository', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repository: FlashSalesRepository;
  const productId = randomUUID();
  const saleId = randomUUID();
  const extraSaleIds: string[] = [];

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
    await dataSource.query('DELETE FROM orders WHERE flash_sale_id = ANY($1::uuid[])', [
      [saleId, ...extraSaleIds],
    ]);
    await dataSource.query('DELETE FROM flash_sales WHERE id = ANY($1::uuid[])', [
      [saleId, ...extraSaleIds],
    ]);
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

  describe('insertIfAbsent', () => {
    function campaignWith(id: string, totalStock: number): FlashSaleCampaign {
      extraSaleIds.push(id);
      return {
        id,
        productId,
        totalStock,
        remainingStock: totalStock,
        startsAt: new Date(STARTS_AT),
        endsAt: new Date(ENDS_AT),
      };
    }

    it('inserts the campaign when its id is missing', async () => {
      const campaign = campaignWith(randomUUID(), 25);

      await repository.insertIfAbsent(campaign);

      await expect(repository.findById(campaign.id)).resolves.toEqual(campaign);
    });

    it('leaves an existing row unchanged when the id already exists', async () => {
      const original = campaignWith(randomUUID(), 25);
      await repository.insertIfAbsent(original);

      await repository.insertIfAbsent({ ...original, totalStock: 99, remainingStock: 99 });

      await expect(repository.findById(original.id)).resolves.toEqual(original);
    });
  });

  describe('reschedule', () => {
    const NEW_START_MS = Date.parse('2031-05-05T10:00:00.000Z');
    const NEW_END_MS = NEW_START_MS + 7_200_000;

    async function seedRescheduleTarget(): Promise<string> {
      const id = randomUUID();
      extraSaleIds.push(id);
      await dataSource.query(
        `INSERT INTO flash_sales (id, product_id, total_stock, remaining_stock, starts_at, ends_at, updated_at)
         VALUES ($1, $2, 10, 3, $3, $4, '2000-01-01T00:00:00Z')`,
        [id, productId, STARTS_AT, ENDS_AT],
      );
      return id;
    }

    it('sets the new stock into both columns and the new window', async () => {
      const id = await seedRescheduleTarget();

      const campaign = await repository.reschedule({
        saleId: id,
        totalStock: 40,
        startsAtMs: NEW_START_MS,
        endsAtMs: NEW_END_MS,
      });

      expect(campaign).toEqual({
        id,
        productId,
        totalStock: 40,
        remainingStock: 40,
        startsAt: new Date(NEW_START_MS),
        endsAt: new Date(NEW_END_MS),
      });
      await expect(repository.findById(id)).resolves.toEqual(campaign);
    });

    it('moves updated_at forward', async () => {
      const id = await seedRescheduleTarget();

      await repository.reschedule({
        saleId: id,
        totalStock: 5,
        startsAtMs: NEW_START_MS,
        endsAtMs: NEW_END_MS,
      });

      const rows: { is_fresh: boolean }[] = await dataSource.query(
        "SELECT updated_at > '2000-01-01T00:00:00Z' AS is_fresh FROM flash_sales WHERE id = $1",
        [id],
      );
      expect(rows[0].is_fresh).toBe(true);
    });

    async function seedOrder(saleOfOrder: string): Promise<void> {
      await dataSource.query(
        `INSERT INTO orders (id, flash_sale_id, product_id, user_id, status)
         VALUES ($1, $2, $3, $4, 'CONFIRMED')`,
        [randomUUID(), saleOfOrder, productId, randomUUID()],
      );
    }

    const orderCount = async (saleOfOrders: string): Promise<number> => {
      const [row] = await dataSource.query(
        'SELECT count(*)::int AS count FROM orders WHERE flash_sale_id = $1',
        [saleOfOrders],
      );
      return row.count;
    };

    it('drops the orders of the rescheduled sale only', async () => {
      const id = await seedRescheduleTarget();
      const otherId = await seedRescheduleTarget();
      await seedOrder(id);
      await seedOrder(otherId);

      await repository.reschedule({
        saleId: id,
        totalStock: 5,
        startsAtMs: NEW_START_MS,
        endsAtMs: NEW_END_MS,
      });

      expect([await orderCount(id), await orderCount(otherId)]).toEqual([0, 1]);
    });

    it('keeps the orders and the row when the rewrite fails', async () => {
      const id = await seedRescheduleTarget();
      await seedOrder(id);

      const result = repository.reschedule({
        saleId: id,
        totalStock: 5,
        startsAtMs: NEW_START_MS,
        endsAtMs: NEW_START_MS,
      });

      await expect(result).rejects.toThrow('ck_flash_sales_window');
      expect(await orderCount(id)).toBe(1);
      expect(await repository.findById(id)).toMatchObject({ totalStock: 10, remainingStock: 3 });
    });

    it('returns null for an unknown id', async () => {
      const campaign = await repository.reschedule({
        saleId: randomUUID(),
        totalStock: 5,
        startsAtMs: NEW_START_MS,
        endsAtMs: NEW_END_MS,
      });

      expect(campaign).toBeNull();
    });

    it('rejects a window that ends at or before its start via ck_flash_sales_window', async () => {
      const id = await seedRescheduleTarget();

      const result = repository.reschedule({
        saleId: id,
        totalStock: 5,
        startsAtMs: NEW_START_MS,
        endsAtMs: NEW_START_MS,
      });

      await expect(result).rejects.toThrow('ck_flash_sales_window');
    });
  });
});
