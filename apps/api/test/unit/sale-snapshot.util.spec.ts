import { buildSaleSnapshot } from '../../src/modules/admin/utils/sale-snapshot.util';
import type { FlashSaleCampaign } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';

const CAMPAIGN: FlashSaleCampaign = {
  id: 'sale-1',
  productId: 'product-1',
  totalStock: 10,
  remainingStock: 10,
  startsAt: new Date('2030-01-01T00:00:00.000Z'),
  endsAt: new Date('2030-01-01T01:00:00.000Z'),
};

describe('buildSaleSnapshot', () => {
  it('maps the campaign row with the dates as epoch milliseconds', () => {
    const snapshot = buildSaleSnapshot(CAMPAIGN, 7);

    expect(snapshot).toEqual({
      saleId: 'sale-1',
      totalStock: 10,
      remainingStock: 7,
      startsAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
      endsAtMs: Date.parse('2030-01-01T01:00:00.000Z'),
    });
  });

  it('takes remaining stock from the argument, not from the campaign row', () => {
    const campaign = { ...CAMPAIGN, remainingStock: 3 };

    const snapshot = buildSaleSnapshot(campaign, 9);

    expect(snapshot.remainingStock).toBe(9);
  });
});
