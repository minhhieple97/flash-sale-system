import { FlashSaleHydrationService } from '../../src/modules/admin/services/flash-sale-hydration.service';
import type { FlashSaleCampaign } from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';
import type {
  ConfirmedReservation,
  LedgerHydrationResult,
  SaleLedgerState,
} from '../../src/modules/orders/interfaces/order.interface';
import type { OrdersService } from '../../src/modules/orders/services/orders.service';
import type { Product } from '../../src/modules/products/interfaces/product.interface';
import type { ProductsService } from '../../src/modules/products/services/products.service';
import { userIdOf } from '../support/user-id.fixtures';

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
  remainingStock: 4,
  startsAt: new Date('2030-01-01T00:00:00.000Z'),
  endsAt: new Date('2030-01-01T01:00:00.000Z'),
};

function confirmedBy(...users: string[]): ConfirmedReservation[] {
  return users.map((user) => ({ userId: userIdOf(user), orderId: `order-${user}` }));
}

function buildService(
  confirmed: readonly ConfirmedReservation[],
  hydrateResult: LedgerHydrationResult = 'HYDRATED',
): {
  service: FlashSaleHydrationService;
  calls: string[];
  hydrateSaleState: jest.Mock<Promise<LedgerHydrationResult>, [SaleLedgerState]>;
} {
  const calls: string[] = [];
  const products = {
    ensureFeaturedProduct: jest.fn(async () => {
      calls.push('ensureFeaturedProduct');
      return PRODUCT;
    }),
  } as unknown as ProductsService;
  const campaigns = {
    ensureActiveCampaign: jest.fn(async (productId: string) => {
      calls.push(`ensureActiveCampaign:${productId}`);
      return CAMPAIGN;
    }),
  } as unknown as FlashSaleCampaignService;
  const hydrateSaleState = jest.fn(async (_state: SaleLedgerState) => hydrateResult);
  const orders = {
    listConfirmedReservations: jest.fn(async (saleId: string) => {
      calls.push(`listConfirmedReservations:${saleId}`);
      return confirmed;
    }),
    hydrateSaleState,
  } as unknown as OrdersService;
  return {
    service: new FlashSaleHydrationService(products, campaigns, orders),
    calls,
    hydrateSaleState,
  };
}

describe('FlashSaleHydrationService', () => {
  it('subtracts the confirmed orders from total stock and passes exactly those entries', async () => {
    const confirmed = confirmedBy('alice', 'bob', 'carol');
    const { service, hydrateSaleState } = buildService(confirmed);

    await service.hydrate();

    const [state] = hydrateSaleState.mock.calls[0];
    expect(state.snapshot.remainingStock).toBe(7);
    expect(state.confirmed).toEqual(confirmed);
  });

  it('keeps remaining stock equal to total stock when nothing is confirmed', async () => {
    const { service, hydrateSaleState } = buildService([]);

    await service.hydrate();

    expect(hydrateSaleState.mock.calls[0][0].snapshot.remainingStock).toBe(10);
  });

  it('ensures the product, then the campaign for it, then lists confirmed orders of that sale', async () => {
    const { service, calls } = buildService([]);

    await service.hydrate();

    expect(calls).toEqual([
      'ensureFeaturedProduct',
      'ensureActiveCampaign:product-1',
      'listConfirmedReservations:sale-1',
    ]);
  });

  it('builds the snapshot from the product and the campaign with dates in milliseconds', async () => {
    const { service, hydrateSaleState } = buildService([]);

    await service.hydrate();

    expect(hydrateSaleState.mock.calls[0][0].snapshot).toEqual({
      saleId: 'sale-1',
      productId: 'product-1',
      productName: 'Phone',
      salePriceCents: 500,
      originalPriceCents: 1000,
      totalStock: 10,
      remainingStock: 10,
      startsAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
      endsAtMs: Date.parse('2030-01-01T01:00:00.000Z'),
    });
  });

  it.each<LedgerHydrationResult>(['HYDRATED', 'ALREADY_PRESENT'])(
    'returns the ledger result %s unchanged',
    async (result) => {
      const { service } = buildService([], result);

      await expect(service.hydrate()).resolves.toBe(result);
    },
  );

  it('rejects boot when hydration rejects', async () => {
    const { service } = buildService([]);
    const failure = new Error('redis down');
    jest.spyOn(service, 'hydrate').mockRejectedValue(failure);

    const boot = service.onApplicationBootstrap();

    await expect(boot).rejects.toBe(failure);
  });

  it('hydrates during boot', async () => {
    const { service, hydrateSaleState } = buildService([]);

    await service.onApplicationBootstrap();

    expect(hydrateSaleState).toHaveBeenCalledTimes(1);
  });
});
