import { NotFoundException } from '@nestjs/common';
import type { ClockService } from '../../src/common/providers/clock.service';
import {
  ACTIVE_FLASH_SALE_ID,
  DEFAULT_CAMPAIGN_DURATION_MS,
  DEFAULT_CAMPAIGN_TOTAL_STOCK,
} from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type {
  FlashSaleCampaign,
  RescheduleCampaignParams,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSalesRepository } from '../../src/modules/flash-sales/repositories/flash-sales.repository';
import { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';

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
const RESCHEDULE: RescheduleCampaignParams = {
  saleId: ACTIVE_FLASH_SALE_ID,
  totalStock: 9,
  startsAtMs: NOW_MS,
  endsAtMs: NOW_MS + 5000,
};

function buildService(stored: FlashSaleCampaign | null): {
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
  return { service: new FlashSaleCampaignService(repository, clock), insertIfAbsent, reschedule };
}

describe('FlashSaleCampaignService', () => {
  describe('ensureActiveCampaign', () => {
    it('seeds the active sale for the product with the default stock from now for 24h', async () => {
      const { service, insertIfAbsent } = buildService(STORED);

      await service.ensureActiveCampaign(PRODUCT_ID);

      expect(insertIfAbsent).toHaveBeenCalledWith({
        id: ACTIVE_FLASH_SALE_ID,
        productId: PRODUCT_ID,
        totalStock: DEFAULT_CAMPAIGN_TOTAL_STOCK,
        remainingStock: DEFAULT_CAMPAIGN_TOTAL_STOCK,
        startsAt: new Date(NOW_MS),
        endsAt: new Date(NOW_MS + DEFAULT_CAMPAIGN_DURATION_MS),
      });
      expect(DEFAULT_CAMPAIGN_TOTAL_STOCK).toBe(100);
    });

    it('returns the stored row, so an existing campaign comes back unchanged', async () => {
      const { service } = buildService(STORED);

      const campaign = await service.ensureActiveCampaign(PRODUCT_ID);

      expect(campaign).toBe(STORED);
    });

    it('rejects with FLASH_SALE_NOT_FOUND when the row is missing after the seed', async () => {
      const { service } = buildService(null);

      const result = service.ensureActiveCampaign(PRODUCT_ID);

      await expect(result).rejects.toMatchObject({ response: { code: 'FLASH_SALE_NOT_FOUND' } });
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
});
