import {
  flashSaleConfigKey,
  flashSaleStockKey,
  flashSaleUsersKey,
} from '../../src/infrastructure/redis/redis.constants';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import { FEATURED_PRODUCT_SEED } from '../../src/modules/products/constants/products.constants';
import { createRealSaleHarness, type RealSaleHarness } from '../support/real-sale.harness';
import { userIdOf } from '../support/user-id.fixtures';

const BUYERS = ['cold-boot-alice', 'cold-boot-bob', 'cold-boot-carol'];

describe('FlashSaleHydrationService against the real containers', () => {
  let harness: RealSaleHarness;

  beforeAll(async () => {
    harness = await createRealSaleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('cold Redis with orders already in PostgreSQL', () => {
    beforeAll(async () => {
      await harness.resetService.reset({
        totalStock: 10,
        startsOffsetSeconds: -60,
        durationSeconds: 3600,
      });
      for (const buyer of BUYERS) await harness.persistOrder(buyer);
      await harness.deleteSaleRedisKeys();
    });

    it('rebuilds stock and the purchase ledger from PostgreSQL', async () => {
      const result = await harness.hydration.hydrate();

      harness.flashSales.invalidateCache();
      const status = await harness.flashSales.getCurrentStatus();
      expect(result).toBe('HYDRATED');
      expect(status.totalStock).toBe(10);
      expect(status.remainingStock).toBe(7);
    });

    it('reads every persisted buyer back as CONFIRMED', async () => {
      const slots = await Promise.all(
        BUYERS.map((buyer) => harness.orderCache.findSlot(ACTIVE_FLASH_SALE_ID, userIdOf(buyer))),
      );

      expect(slots.map((slot) => slot.status)).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED']);
    });

    it('rejects a repeat purchase by a hydrated buyer as ALREADY_PURCHASED', async () => {
      const result = await harness.checkout.attemptPurchase(userIdOf(BUYERS[0]));

      expect(result).toEqual({ outcome: 'ALREADY_PURCHASED' });
    });

    it('answers ALREADY_PRESENT on a second hydrate and leaves live Redis state alone', async () => {
      await harness.redis.set(flashSaleStockKey(ACTIVE_FLASH_SALE_ID), '3');

      const result = await harness.hydration.hydrate();

      expect(result).toBe('ALREADY_PRESENT');
      await expect(harness.redis.get(flashSaleStockKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe('3');
      await expect(harness.redis.hlen(flashSaleUsersKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe(3);
    });
  });

  describe('empty PostgreSQL and empty Redis', () => {
    beforeAll(async () => {
      await harness.deleteSaleRows();
      await harness.deleteSaleRedisKeys();
    });

    it('seeds the product, the campaign and the Redis state', async () => {
      const result = await harness.hydration.hydrate();

      expect(result).toBe('HYDRATED');
      harness.flashSales.invalidateCache();
      const status = await harness.flashSales.getCurrentStatus();
      expect(status).toMatchObject({
        saleId: ACTIVE_FLASH_SALE_ID,
        productName: FEATURED_PRODUCT_SEED.name,
        saleState: 'ACTIVE',
        totalStock: 100,
        remainingStock: 100,
      });
      await expect(harness.redis.exists(flashSaleConfigKey(ACTIVE_FLASH_SALE_ID))).resolves.toBe(1);
    });

    it('creates exactly one product row and one sale row', async () => {
      const products = await harness.dataSource.query('SELECT id FROM products WHERE id = $1', [
        FEATURED_PRODUCT_SEED.id,
      ]);
      const sales = await harness.dataSource.query('SELECT id FROM flash_sales WHERE id = $1', [
        ACTIVE_FLASH_SALE_ID,
      ]);

      expect([products.length, sales.length]).toEqual([1, 1]);
    });
  });
});
