import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type {
  FlashSaleCampaign,
  SaleWindowConfig,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import {
  applyExplicitSaleConfig,
  matchesSaleWindow,
  parseExplicitSaleConfig,
  resolveSaleWindow,
} from '../../src/modules/flash-sales/utils/sale-window.util';

const NOW_MS = 1_800_000_000_000;
const STARTS_AT = '2030-01-01T00:00:00.000Z';
const ENDS_AT = '2030-01-01T01:00:00.000Z';
const WINDOW: SaleWindowConfig = {
  startsAtMs: Date.parse(STARTS_AT),
  endsAtMs: Date.parse(ENDS_AT),
  totalStock: 5,
};
const CAMPAIGN: FlashSaleCampaign = {
  id: ACTIVE_FLASH_SALE_ID,
  productId: 'product-1',
  totalStock: 7,
  remainingStock: 2,
  startsAt: new Date(NOW_MS - 1000),
  endsAt: new Date(NOW_MS + 1000),
};
const STORED_WINDOW: SaleWindowConfig = {
  startsAtMs: CAMPAIGN.startsAt.getTime(),
  endsAtMs: CAMPAIGN.endsAt.getTime(),
  totalStock: CAMPAIGN.totalStock,
};

describe('parseExplicitSaleConfig', () => {
  it('is empty when no SALE_* variable is set', () => {
    expect(parseExplicitSaleConfig({})).toEqual({});
  });

  it('reads the window as epoch milliseconds and the stock as a number', () => {
    const explicit = parseExplicitSaleConfig({
      SALE_STARTS_AT: STARTS_AT,
      SALE_ENDS_AT: ENDS_AT,
      SALE_TOTAL_STOCK: 5,
    });

    expect(explicit).toEqual({
      window: { startsAtMs: WINDOW.startsAtMs, endsAtMs: WINDOW.endsAtMs },
      totalStock: 5,
    });
  });

  it('honours an explicit offset', () => {
    const explicit = parseExplicitSaleConfig({
      SALE_STARTS_AT: '2030-01-01T07:00:00+07:00',
      SALE_ENDS_AT: '2030-01-01T08:00:00+07:00',
    });

    expect(explicit.window).toEqual({ startsAtMs: WINDOW.startsAtMs, endsAtMs: WINDOW.endsAtMs });
  });

  it('leaves the window out when only the stock is set', () => {
    expect(parseExplicitSaleConfig({ SALE_TOTAL_STOCK: 5 })).toEqual({ totalStock: 5 });
  });
});

describe('resolveSaleWindow', () => {
  it('defaults to now, now plus 24 h and 100 units', () => {
    const window = resolveSaleWindow({}, NOW_MS);

    expect(window).toEqual({ startsAtMs: NOW_MS, endsAtMs: NOW_MS + 86_400_000, totalStock: 100 });
  });

  it('uses the explicit window and stock as given', () => {
    const window = resolveSaleWindow({ window: WINDOW, totalStock: 5 }, NOW_MS);

    expect(window).toEqual(WINDOW);
  });

  it('falls back to the default window around a configured stock', () => {
    const window = resolveSaleWindow({ totalStock: 9 }, NOW_MS);

    expect(window).toEqual({ startsAtMs: NOW_MS, endsAtMs: NOW_MS + 86_400_000, totalStock: 9 });
  });
});

describe('applyExplicitSaleConfig', () => {
  it('keeps the stored sale when nothing is explicit, whatever the clock says', () => {
    expect(applyExplicitSaleConfig(CAMPAIGN, {})).toEqual(STORED_WINDOW);
  });

  it('keeps the stored window when only the stock is explicit', () => {
    const target = applyExplicitSaleConfig(CAMPAIGN, { totalStock: 3 });

    expect(target).toEqual({ ...STORED_WINDOW, totalStock: 3 });
  });

  it('keeps the stored stock when only the window is explicit', () => {
    const target = applyExplicitSaleConfig(CAMPAIGN, { window: WINDOW });

    expect(target).toEqual({ ...WINDOW, totalStock: CAMPAIGN.totalStock });
  });

  it('takes both parts when both are explicit', () => {
    expect(applyExplicitSaleConfig(CAMPAIGN, { window: WINDOW, totalStock: 5 })).toEqual(WINDOW);
  });
});

describe('matchesSaleWindow', () => {
  it('matches a campaign only when window and stock are equal', () => {
    expect(matchesSaleWindow(CAMPAIGN, STORED_WINDOW)).toBe(true);
    expect(
      matchesSaleWindow(CAMPAIGN, { ...STORED_WINDOW, startsAtMs: STORED_WINDOW.startsAtMs + 1 }),
    ).toBe(false);
    expect(
      matchesSaleWindow(CAMPAIGN, { ...STORED_WINDOW, endsAtMs: STORED_WINDOW.endsAtMs - 1 }),
    ).toBe(false);
    expect(matchesSaleWindow(CAMPAIGN, { ...STORED_WINDOW, totalStock: 6 })).toBe(false);
  });
});
