import { Logger } from '@nestjs/common';
import { FlashSaleHydrationService } from '../../src/modules/admin/services/flash-sale-hydration.service';
import type {
  ExplicitSaleConfig,
  FlashSaleCampaign,
  RescheduleCampaignParams,
  SaleWindowConfig,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';
import type {
  ConfirmedBatchPage,
  ListConfirmedBatchParams,
} from '../../src/modules/orders/interfaces/order.interface';
import type { OrdersService } from '../../src/modules/orders/services/orders.service';
import type { Product } from '../../src/modules/products/interfaces/product.interface';
import type { ProductsService } from '../../src/modules/products/services/products.service';
import type {
  ConfirmedReservation,
  LedgerHydrationResult,
  SaleLedgerRepository,
  SaleLedgerState,
} from '../../src/modules/sale-ledger';
import { userIdOf } from './user-id.fixtures';

export const PRODUCT: Product = {
  id: 'product-1',
  sku: 'SKU-1',
  name: 'Phone',
  description: 'A phone',
  originalPriceCents: 1000,
  salePriceCents: 500,
  imageUrl: null,
};
export const CAMPAIGN: FlashSaleCampaign = {
  id: 'sale-1',
  productId: 'product-1',
  totalStock: 10,
  remainingStock: 4,
  startsAt: new Date('2030-01-01T00:00:00.000Z'),
  endsAt: new Date('2030-01-01T01:00:00.000Z'),
};

export function confirmedBy(...users: string[]): ConfirmedReservation[] {
  return users.map((user) => ({ userId: userIdOf(user), orderId: `order-${user}` }));
}

export interface BuildOptions {
  confirmed?: readonly ConfirmedReservation[];
  hydrateResult?: LedgerHydrationResult;
  window?: SaleWindowConfig;
  explicit?: ExplicitSaleConfig;
  ledgerEntries?: number;
  isIntact?: boolean;
}

export interface Built {
  service: FlashSaleHydrationService;
  calls: string[];
  hasConfirmedOrders: jest.Mock<Promise<boolean>, [string]>;
  listConfirmedBatch: jest.Mock<Promise<ConfirmedBatchPage>, [ListConfirmedBatchParams]>;
  restoreConfirmedBatch: jest.Mock<Promise<boolean>, [string, readonly ConfirmedReservation[]]>;
  restoreLostState: jest.Mock<Promise<LedgerHydrationResult>, [SaleLedgerState]>;
  replaceState: jest.Mock<Promise<void>, [SaleLedgerState]>;
  rescheduleCampaign: jest.Mock<Promise<FlashSaleCampaign>, [RescheduleCampaignParams]>;
  warn: jest.SpyInstance;
}

export const STORED_WINDOW: SaleWindowConfig = {
  startsAtMs: CAMPAIGN.startsAt.getTime(),
  endsAtMs: CAMPAIGN.endsAt.getTime(),
  totalStock: CAMPAIGN.totalStock,
};
export const NEW_WINDOW: SaleWindowConfig = {
  startsAtMs: STORED_WINDOW.startsAtMs + 60_000,
  endsAtMs: STORED_WINDOW.endsAtMs + 60_000,
  totalStock: 3,
};
export const EXPLICIT_STOCK: ExplicitSaleConfig = { totalStock: 3 };
export const EXPLICIT_NEW_SALE: ExplicitSaleConfig = {
  window: { startsAtMs: NEW_WINDOW.startsAtMs, endsAtMs: NEW_WINDOW.endsAtMs },
  totalStock: NEW_WINDOW.totalStock,
};

export function buildService(options: BuildOptions = {}): Built {
  const {
    confirmed = [],
    hydrateResult = 'HYDRATED',
    explicit = {},
    ledgerEntries = 0,
    isIntact = true,
  } = options;
  const window = options.window ?? STORED_WINDOW;
  const calls: string[] = [];
  const products = {
    ensureFeaturedProduct: jest.fn(async () => {
      calls.push('ensureFeaturedProduct');
      return PRODUCT;
    }),
  } as unknown as ProductsService;
  const rescheduleCampaign = jest.fn(async (params: RescheduleCampaignParams) => {
    calls.push('rescheduleCampaign');
    return {
      ...CAMPAIGN,
      totalStock: params.totalStock,
      remainingStock: params.totalStock,
      startsAt: new Date(params.startsAtMs),
      endsAt: new Date(params.endsAtMs),
    };
  });
  const campaigns = {
    configuredWindow: jest.fn(() => window),
    explicitConfig: jest.fn(() => explicit),
    ensureActiveCampaign: jest.fn(async (productId: string) => {
      calls.push(`ensureActiveCampaign:${productId}`);
      return CAMPAIGN;
    }),
    getActiveCampaign: jest.fn(async () => {
      calls.push('getActiveCampaign');
      return CAMPAIGN;
    }),
    rescheduleCampaign,
  } as unknown as FlashSaleCampaignService;
  const restoreConfirmedBatch = jest.fn(
    async (_saleId: string, entries: readonly ConfirmedReservation[]) => entries.length > 0,
  );
  const restoreLostState = jest.fn(async (_state: SaleLedgerState) => hydrateResult);
  const replaceState = jest.fn(async (_state: SaleLedgerState) => {
    calls.push('replaceState');
  });
  const hasConfirmedOrders = jest.fn(async (saleId: string) => {
    calls.push(`hasConfirmedOrders:${saleId}`);
    return confirmed.length > 0;
  });
  const listConfirmedBatch = jest.fn(async (params: ListConfirmedBatchParams) => {
    calls.push(`listConfirmedBatch:${params.saleId}`);
    const offset = params.cursor ? Number(params.cursor.id) : 0;
    const entries = confirmed.slice(offset, offset + params.limit);
    const nextOffset = offset + entries.length;
    const nextCursor =
      nextOffset < confirmed.length
        ? { createdAt: '2030-01-01T00:00:00.000Z', id: String(nextOffset) }
        : null;
    return { entries, nextCursor };
  });
  const orders = {
    hasConfirmedOrders,
    listConfirmedBatch,
  } as unknown as OrdersService;
  const ledger = {
    countEntries: jest.fn(async () => ledgerEntries),
    isIntact: jest.fn(async (saleId: string) => {
      calls.push(`isIntact:${saleId}`);
      return isIntact;
    }),
    restoreConfirmedBatch,
    restoreLostState,
    replaceState,
  } as unknown as SaleLedgerRepository;
  const service = new FlashSaleHydrationService(products, campaigns, orders, ledger);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  return {
    service,
    calls,
    hasConfirmedOrders,
    listConfirmedBatch,
    restoreConfirmedBatch,
    restoreLostState,
    replaceState,
    rescheduleCampaign,
    warn,
  };
}
