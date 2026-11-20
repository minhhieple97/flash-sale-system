import type { ClockService } from '../../src/common/providers/clock.service';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type {
  FlashSaleCampaign,
  FlashSaleStatus,
  RescheduleCampaignParams,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';
import type { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type { SaleLedgerState } from '../../src/modules/orders/interfaces/order.interface';
import type { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type { OrdersService } from '../../src/modules/orders/services/orders.service';
import type { Product } from '../../src/modules/products/interfaces/product.interface';
import type { ProductsService } from '../../src/modules/products/services/products.service';
import { buildSnapshot } from '../support/flash-sale.fixtures';

const NOW_MS = 1_800_000_000_000;
const PRODUCT: Product = {
  id: 'product-1',
  sku: 'SKU-1',
  name: 'Stored Name',
  description: 'A phone',
  originalPriceCents: 1000,
  salePriceCents: 500,
  imageUrl: null,
};
const STATUS: FlashSaleStatus = {
  ...buildSnapshot(),
  saleState: 'ACTIVE',
  serverTimeMs: NOW_MS,
};

function campaignFor(params: RescheduleCampaignParams): FlashSaleCampaign {
  return {
    id: params.saleId,
    productId: PRODUCT.id,
    totalStock: params.totalStock,
    remainingStock: params.totalStock,
    startsAt: new Date(params.startsAtMs),
    endsAt: new Date(params.endsAtMs),
  };
}

function buildService(): {
  service: FlashSaleResetService;
  calls: string[];
  rescheduleCampaign: jest.Mock<Promise<FlashSaleCampaign>, [RescheduleCampaignParams]>;
  replaceSaleState: jest.Mock<Promise<void>, [SaleLedgerState]>;
  discardSaleOrders: jest.Mock<Promise<void>, [string]>;
} {
  const calls: string[] = [];
  const discardSaleOrders = jest.fn(async (_saleId: string) => {
    calls.push('discardSaleOrders');
  });
  const rescheduleCampaign = jest.fn(async (params: RescheduleCampaignParams) => {
    calls.push('rescheduleCampaign');
    return campaignFor(params);
  });
  const replaceSaleState = jest.fn(async (_state: SaleLedgerState) => {
    calls.push('replaceSaleState');
  });
  const products = {
    getFeaturedProduct: jest.fn(async () => PRODUCT),
  } as unknown as ProductsService;
  const campaigns = { rescheduleCampaign } as unknown as FlashSaleCampaignService;
  const flashSales = {
    invalidateCache: jest.fn(() => {
      calls.push('invalidateCache');
    }),
    getCurrentStatus: jest.fn(async () => {
      calls.push('getCurrentStatus');
      return STATUS;
    }),
  } as unknown as FlashSalesService;
  const orders = { replaceSaleState } as unknown as OrdersService;
  const persistence = { discardSaleOrders } as unknown as OrderPersistenceService;
  const clock = { nowMs: (): number => NOW_MS } as unknown as ClockService;
  const service = new FlashSaleResetService(
    products,
    campaigns,
    flashSales,
    orders,
    persistence,
    clock,
  );
  return { service, calls, rescheduleCampaign, replaceSaleState, discardSaleOrders };
}

describe('FlashSaleResetService', () => {
  it('discards orders, reschedules, replaces the ledger, drops the micro-cache, then reads the status', async () => {
    const { service, calls } = buildService();

    await service.reset({});

    expect(calls).toEqual([
      'discardSaleOrders',
      'rescheduleCampaign',
      'replaceSaleState',
      'invalidateCache',
      'getCurrentStatus',
    ]);
  });

  it('targets the active sale for both the discard and the reschedule', async () => {
    const { service, discardSaleOrders, rescheduleCampaign } = buildService();

    await service.reset({ totalStock: 5, startsOffsetSeconds: -60, durationSeconds: 3600 });

    expect(discardSaleOrders).toHaveBeenCalledWith(ACTIVE_FLASH_SALE_ID);
    expect(rescheduleCampaign).toHaveBeenCalledWith({
      saleId: ACTIVE_FLASH_SALE_ID,
      totalStock: 5,
      startsAtMs: NOW_MS - 60_000,
      endsAtMs: NOW_MS + 3_540_000,
    });
  });

  it('replaces the ledger with no confirmed orders and remaining stock equal to total stock', async () => {
    const { service, replaceSaleState } = buildService();

    await service.reset({ totalStock: 5 });

    const [state] = replaceSaleState.mock.calls[0];
    expect(state.confirmed).toEqual([]);
    expect(state.snapshot.totalStock).toBe(5);
    expect(state.snapshot.remainingStock).toBe(5);
  });

  it('puts the productName override into the snapshot', async () => {
    const { service, replaceSaleState } = buildService();

    await service.reset({ productName: 'Demo Name' });

    expect(replaceSaleState.mock.calls[0][0].snapshot.productName).toBe('Demo Name');
  });

  it('keeps the stored product name when no override is given', async () => {
    const { service, replaceSaleState } = buildService();

    await service.reset({});

    expect(replaceSaleState.mock.calls[0][0].snapshot.productName).toBe('Stored Name');
  });

  it('returns what getCurrentStatus returned', async () => {
    const { service } = buildService();

    const status = await service.reset({});

    expect(status).toBe(STATUS);
  });
});
