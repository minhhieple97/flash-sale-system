import type { ClockService } from '../../src/common/providers/clock.service';
import { FlashSaleResetService } from '../../src/modules/admin/services/flash-sale-reset.service';
import type {
  FlashSaleCampaign,
  FlashSaleStatus,
  RescheduleCampaignParams,
} from '../../src/modules/flash-sales/interfaces/flash-sale.interface';
import type { FlashSaleCampaignService } from '../../src/modules/flash-sales/services/flash-sale-campaign.service';
import type { FlashSalesService } from '../../src/modules/flash-sales/services/flash-sales.service';
import type { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type {
  MaintenanceLease,
  SaleLedgerLeaseRepository,
  SaleLedgerRepository,
  SaleLedgerState,
} from '../../src/modules/sale-ledger';
import { buildSnapshot } from './flash-sale.fixtures';

export const NOW_MS = 1_800_000_000_000;
const PRODUCT_ID = 'product-1';
export const STATUS: FlashSaleStatus = {
  ...buildSnapshot(),
  saleState: 'ACTIVE',
  serverTimeMs: NOW_MS,
};

function campaignFor(params: RescheduleCampaignParams): FlashSaleCampaign {
  return {
    id: params.saleId,
    productId: PRODUCT_ID,
    totalStock: params.totalStock,
    remainingStock: params.totalStock,
    startsAt: new Date(params.startsAtMs),
    endsAt: new Date(params.endsAtMs),
  };
}

export interface ResetServiceMocks {
  service: FlashSaleResetService;
  calls: string[];
  rescheduleCampaign: jest.Mock<Promise<FlashSaleCampaign>, [RescheduleCampaignParams]>;
  invalidateState: jest.Mock<Promise<void>, [string]>;
  replaceState: jest.Mock<Promise<void>, [SaleLedgerState]>;
  drainPendingJobs: jest.Mock<Promise<void>, []>;
  resumeProcessing: jest.Mock<Promise<void>, []>;
  acquireMaintenanceLease: jest.Mock<Promise<boolean>, [MaintenanceLease]>;
  releaseMaintenanceLease: jest.Mock<Promise<boolean>, [string, string]>;
}

export function buildService(): ResetServiceMocks {
  const calls: string[] = [];
  const drainPendingJobs = jest.fn(async () => {
    calls.push('drainPendingJobs');
  });
  const resumeProcessing = jest.fn(async () => {
    calls.push('resumeProcessing');
  });
  const rescheduleCampaign = jest.fn(async (params: RescheduleCampaignParams) => {
    calls.push('rescheduleCampaign');
    return campaignFor(params);
  });
  const invalidateState = jest.fn(async (_saleId: string) => {
    calls.push('invalidateState');
  });
  const replaceState = jest.fn(async (_state: SaleLedgerState) => {
    calls.push('replaceState');
  });
  const acquireMaintenanceLease = jest.fn<Promise<boolean>, [MaintenanceLease]>(async () => true);
  const releaseMaintenanceLease = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const campaigns = {
    rescheduleCampaign,
    configuredWindow: () => ({ startsAtMs: NOW_MS, endsAtMs: NOW_MS + 1000, totalStock: 100 }),
  } as unknown as FlashSaleCampaignService;
  const flashSales = {
    invalidateCache: jest.fn(() => {
      calls.push('invalidateCache');
    }),
    getCurrentStatus: jest.fn(async () => {
      calls.push('getCurrentStatus');
      return STATUS;
    }),
  } as unknown as FlashSalesService;
  const ledger = { invalidateState, replaceState } as unknown as SaleLedgerRepository;
  const leases = {
    acquireMaintenanceLease,
    releaseMaintenanceLease,
  } as unknown as SaleLedgerLeaseRepository;
  const persistence = { drainPendingJobs, resumeProcessing } as unknown as OrderPersistenceService;
  const clock = { nowMs: (): number => NOW_MS } as unknown as ClockService;
  const service = new FlashSaleResetService(
    campaigns,
    flashSales,
    persistence,
    ledger,
    leases,
    clock,
  );
  return {
    service,
    calls,
    rescheduleCampaign,
    invalidateState,
    replaceState,
    drainPendingJobs,
    resumeProcessing,
    acquireMaintenanceLease,
    releaseMaintenanceLease,
  };
}
