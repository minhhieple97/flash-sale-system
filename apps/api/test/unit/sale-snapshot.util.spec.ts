import { buildSaleSnapshot } from '../../src/modules/admin/utils/sale-snapshot.util';
import type { FlashSaleCampaign } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { Product } from '../../src/modules/products/interfaces/product.interface';

const PRODUCT: Product = {
  id: 'product-1',
  sku: 'SKU-1',
  name: 'Phone',
  description: 'A phone',
  originalPriceCents: 1000,
  salePriceCents: 500,
  imageUrl: null,
};
const CAMPAIGN: FlashSaleCampaign = {
  id: 'sale-1',
  productId: 'product-1',
  totalStock: 10,
  remainingStock: 10,
  startsAt: new Date('2030-01-01T00:00:00.000Z'),
  endsAt: new Date('2030-01-01T01:00:00.000Z'),
};

describe('buildSaleSnapshot', () => {
  it('joins the product row and the campaign row with the dates as epoch milliseconds', () => {
    const snapshot = buildSaleSnapshot({ product: PRODUCT, campaign: CAMPAIGN, remainingStock: 7 });

    expect(snapshot).toEqual({
      saleId: 'sale-1',
      productId: 'product-1',
      productName: 'Phone',
      salePriceCents: 500,
      originalPriceCents: 1000,
      totalStock: 10,
      remainingStock: 7,
      startsAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
      endsAtMs: Date.parse('2030-01-01T01:00:00.000Z'),
    });
  });

  it('takes remaining stock from the argument, not from the campaign row', () => {
    const campaign = { ...CAMPAIGN, remainingStock: 3 };

    const snapshot = buildSaleSnapshot({ product: PRODUCT, campaign, remainingStock: 9 });

    expect(snapshot.remainingStock).toBe(9);
  });
});
