import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClockService } from '../../src/common/providers/clock.service';
import type { AppEnv } from '../../src/config/env.interface';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type {
  FlashSaleCampaign,
  RescheduleCampaignParams,
  SaleWindowConfig,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSalesRepository } from '../../src/modules/flash-sales/repositories/flash-sales.repository';
import { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';
import { computeSaleState } from '../../src/modules/flash-sales/utils/sale-state.util';

const NOW_MS = 1_800_000_000_000;
const PRODUCT_ID = 'product-1';
const STORED: FlashSaleCampaign = {
  id: ACTIVE_FLASH_SALE_ID,
  productId: PRODUCT_ID,
  totalStock: 7,
  remainingStock: 3,
  startsAt: new Date(NOW_MS - 1000),
  endsAt: new Date(NOW_MS + 1000),
};
const WINDOW: SaleWindowConfig = {
  startsAtMs: NOW_MS + 120_000,
  endsAtMs: NOW_MS + 600_000,
  totalStock: 5,
};
const RESCHEDULE: RescheduleCampaignParams = {
  saleId: ACTIVE_FLASH_SALE_ID,
  totalStock: 9,
  startsAtMs: NOW_MS,
  endsAtMs: NOW_MS + 5000,
};

function buildService(
  stored: FlashSaleCampaign | null,
  env: Partial<AppEnv> = {},
): {
  service: FlashSaleCampaignService;
  insertIfAbsent: jest.Mock<Promise<void>, [FlashSaleCampaign]>;
  reschedule: jest.Mock<Promise<FlashSaleCampaign | null>, [RescheduleCampaignParams]>;
} {
  const insertIfAbsent = jest.fn<Promise<void>, [FlashSaleCampaign]>().mockResolvedValue();
  const findById = jest.fn<Promise<FlashSaleCampaign | null>, [string]>().mockResolvedValue(stored);
  const reschedule = jest
    .fn<Promise<FlashSaleCampaign | null>, [RescheduleCampaignParams]>()
    .mockResolvedValue(stored);
  const repository = { insertIfAbsent, findById, reschedule } as unknown as FlashSalesRepository;
  const clock = { nowMs: (): number => NOW_MS } as unknown as ClockService;
  const config = { get: (name: keyof AppEnv) => env[name] } as unknown as ConfigService<
    AppEnv,
    true
  >;
  return {
    service: new FlashSaleCampaignService(repository, clock, config),
    insertIfAbsent,
    reschedule,
  };
}

describe('FlashSaleCampaignService', () => {
  describe('ensureActiveCampaign', () => {
    it('seeds the active sale with the configured window and stock', async () => {
      const { service, insertIfAbsent } = buildService(STORED);

      await service.ensureActiveCampaign(PRODUCT_ID, WINDOW);

      expect(insertIfAbsent).toHaveBeenCalledWith({
        id: ACTIVE_FLASH_SALE_ID,
        productId: PRODUCT_ID,
        totalStock: 5,
        remainingStock: 5,
        startsAt: new Date(WINDOW.startsAtMs),
        endsAt: new Date(WINDOW.endsAtMs),
      });
    });

    it.each([
      ['startsAt - 1', WINDOW.startsAtMs - 1, 'UPCOMING'],
      ['startsAt', WINDOW.startsAtMs, 'ACTIVE'],
      ['endsAt', WINDOW.endsAtMs, 'ACTIVE'],
      ['endsAt + 1', WINDOW.endsAtMs + 1, 'ENDED'],
    ])('reports the seeded sale at %s (%d) as %s', async (_label, nowMs, expected) => {
      const { service, insertIfAbsent } = buildService(STORED);
      await service.ensureActiveCampaign(PRODUCT_ID, WINDOW);
      const seeded = insertIfAbsent.mock.calls[0][0];

      const state = computeSaleState(
        {
          saleId: seeded.id,
          totalStock: seeded.totalStock,
          remainingStock: seeded.remainingStock,
          startsAtMs: seeded.startsAt.getTime(),
          endsAtMs: seeded.endsAt.getTime(),
        },
        nowMs,
      );

      expect(state).toBe(expected);
    });

    it('returns the stored row, so an existing campaign comes back unchanged', async () => {
      const { service } = buildService(STORED);

      const campaign = await service.ensureActiveCampaign(PRODUCT_ID, WINDOW);

      expect(campaign).toBe(STORED);
    });

    it('rejects with FLASH_SALE_NOT_FOUND when the row is missing after the seed', async () => {
      const { service } = buildService(null);

      const result = service.ensureActiveCampaign(PRODUCT_ID, WINDOW);

      await expect(result).rejects.toMatchObject({ response: { code: 'FLASH_SALE_NOT_FOUND' } });
    });
  });

  describe('configuredWindow', () => {
    it('resolves the SALE_* variables against the clock', () => {
      const { service } = buildService(STORED, {
        SALE_STARTS_AT: new Date(WINDOW.startsAtMs).toISOString(),
        SALE_ENDS_AT: new Date(WINDOW.endsAtMs).toISOString(),
        SALE_TOTAL_STOCK: 5,
      });

      expect(service.configuredWindow()).toEqual(WINDOW);
    });

    it('treats variables that compose passes through as empty strings as unset', () => {
      const { service } = buildService(STORED, {
        SALE_STARTS_AT: '',
        SALE_ENDS_AT: '',
        SALE_TOTAL_STOCK: '' as unknown as number,
      });

      expect(service.configuredWindow()).toEqual({
        startsAtMs: NOW_MS,
        endsAtMs: NOW_MS + 86_400_000,
        totalStock: 100,
      });
    });

    it('defaults to a 24 h window of 100 units from now when nothing is set', () => {
      const { service } = buildService(STORED);

      expect(service.configuredWindow()).toEqual({
        startsAtMs: NOW_MS,
        endsAtMs: NOW_MS + 86_400_000,
        totalStock: 100,
      });
    });
  });

  describe('explicitConfig', () => {
    it('reports only the SALE_* variables that are set, as numbers', () => {
      const { service } = buildService(STORED, {
        SALE_STARTS_AT: new Date(WINDOW.startsAtMs).toISOString(),
        SALE_ENDS_AT: new Date(WINDOW.endsAtMs).toISOString(),
        SALE_TOTAL_STOCK: 5,
      });

      expect(service.explicitConfig()).toEqual({
        window: { startsAtMs: WINDOW.startsAtMs, endsAtMs: WINDOW.endsAtMs },
        totalStock: 5,
      });
    });

    it('is empty for variables that compose passes through as empty strings', () => {
      const { service } = buildService(STORED, {
        SALE_STARTS_AT: '',
        SALE_ENDS_AT: '',
        SALE_TOTAL_STOCK: '' as unknown as number,
      });

      expect(service.explicitConfig()).toEqual({});
    });

    it('reports a lone stock without a window', () => {
      const { service } = buildService(STORED, { SALE_TOTAL_STOCK: 5 });

      expect(service.explicitConfig()).toEqual({ totalStock: 5 });
    });
  });

  describe('rescheduleCampaign', () => {
    it('hands the params to the repository and returns the rewritten campaign', async () => {
      const { service, reschedule } = buildService(STORED);

      const campaign = await service.rescheduleCampaign(RESCHEDULE);

      expect(reschedule).toHaveBeenCalledWith(RESCHEDULE);
      expect(campaign).toBe(STORED);
    });

    it('throws NotFoundException with FLASH_SALE_NOT_FOUND when the row is missing', async () => {
      const { service } = buildService(null);

      const result = service.rescheduleCampaign(RESCHEDULE);

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      await expect(result).rejects.toMatchObject({ response: { code: 'FLASH_SALE_NOT_FOUND' } });
    });
  });

  describe('getActiveCampaign', () => {
    it('returns the stored row and never inserts one', async () => {
      const { service, insertIfAbsent } = buildService(STORED);

      const campaign = await service.getActiveCampaign();

      expect(campaign).toBe(STORED);
      expect(insertIfAbsent).not.toHaveBeenCalled();
    });

    it('rejects with FLASH_SALE_NOT_FOUND when the row is missing', async () => {
      const { service } = buildService(null);

      const result = service.getActiveCampaign();

      await expect(result).rejects.toMatchObject({ response: { code: 'FLASH_SALE_NOT_FOUND' } });
    });
  });
});
