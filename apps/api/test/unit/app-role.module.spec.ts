import type { DynamicModule, Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AppModule as AppModuleType } from '../../src/app.module';
import { AdminModule } from '../../src/modules/admin/admin.module';
import {
  BOOTSTRAP_SWEEP_TRIGGER,
  LEDGER_MAINTENANCE_INTERVAL,
  LEDGER_MAINTENANCE_INTERVAL_MS,
  MAINTENANCE_DISABLED,
} from '../../src/modules/admin/constants/admin.constants';
import { AdminFlashSaleController } from '../../src/modules/admin/controllers/admin-flash-sale.controller';
import { FlashSaleHydrationService } from '../../src/modules/admin/services/flash-sale-hydration.service';
import { LedgerMaintenanceService } from '../../src/modules/admin/services/ledger-maintenance.service';
import { CheckoutController } from '../../src/modules/checkout/controllers/checkout.controller';
import { HealthController } from '../../src/modules/health/controllers/health.controller';
import { MetricsController } from '../../src/modules/metrics/controllers/metrics.controller';
import { OrdersController } from '../../src/modules/orders/controllers/orders.controller';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';

const TEST_ENV: Readonly<Record<string, string>> = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'flash_sale',
  POSTGRES_PASSWORD: 'flash_sale',
  POSTGRES_DB: 'flash_sale',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
};

interface InspectedGraph {
  controllers: Set<unknown>;
  providers: Set<unknown>;
  maintenanceInterval: unknown;
  bootstrapSweepTrigger: unknown;
}

async function inspectModule(root: Type<unknown> | DynamicModule): Promise<InspectedGraph> {
  const moduleRef = await Test.createTestingModule({ imports: [root] }).compile({ preview: true });
  const container = moduleRef.get(ModulesContainer);
  const controllers = new Set<unknown>();
  const providerValues = new Map<unknown, unknown>();
  for (const module of container.values()) {
    for (const token of module.controllers.keys()) controllers.add(token);
    for (const [token, wrapper] of module.providers.entries()) {
      providerValues.set(token, wrapper.instance);
    }
  }
  return {
    controllers,
    providers: new Set(providerValues.keys()),
    maintenanceInterval: providerValues.get(LEDGER_MAINTENANCE_INTERVAL),
    bootstrapSweepTrigger: providerValues.get(BOOTSTRAP_SWEEP_TRIGGER),
  };
}

describe('APP_ROLE module split', () => {
  let AppModule: typeof AppModuleType;
  const savedEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      savedEnv.set(key, process.env[key]);
      process.env[key] ??= value;
    }
    ({ AppModule } = await import('../../src/app.module'));
  });

  afterAll(() => {
    for (const [key, value] of savedEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps static AppModule equivalent to role "all"', async () => {
    const graph = await inspectModule(AppModule);

    expect(graph.controllers.has(CheckoutController)).toBe(true);
    expect(graph.controllers.has(OrdersController)).toBe(true);
    expect(graph.controllers.has(AdminFlashSaleController)).toBe(true);
    expect(graph.controllers.has(HealthController)).toBe(true);
    expect(graph.controllers.has(MetricsController)).toBe(true);
    expect(graph.providers.has(OrderPersistenceProcessor)).toBe(true);
    expect(graph.providers.has(LedgerMaintenanceService)).toBe(true);
    expect(graph.maintenanceInterval).toBe(LEDGER_MAINTENANCE_INTERVAL_MS);
    expect(graph.bootstrapSweepTrigger).toBe('BOOT');
  });

  it('builds AppModule.forRole("all") with all controllers, processor and maintenance interval', async () => {
    const graph = await inspectModule(AppModule.forRole('all'));

    expect(graph.controllers.has(CheckoutController)).toBe(true);
    expect(graph.controllers.has(OrdersController)).toBe(true);
    expect(graph.controllers.has(AdminFlashSaleController)).toBe(true);
    expect(graph.controllers.has(MetricsController)).toBe(true);
    expect(graph.providers.has(OrderPersistenceProcessor)).toBe(true);
    expect(graph.maintenanceInterval).toBe(LEDGER_MAINTENANCE_INTERVAL_MS);
    expect(graph.bootstrapSweepTrigger).toBe('BOOT');
  });

  it('builds AppModule.forRole("api") without OrderPersistenceProcessor and with maintenance disabled', async () => {
    const graph = await inspectModule(AppModule.forRole('api'));

    expect(graph.controllers.has(CheckoutController)).toBe(true);
    expect(graph.controllers.has(OrdersController)).toBe(true);
    expect(graph.controllers.has(AdminFlashSaleController)).toBe(true);
    expect(graph.controllers.has(HealthController)).toBe(true);
    expect(graph.controllers.has(MetricsController)).toBe(true);
    expect(graph.providers.has(OrderPersistenceProcessor)).toBe(false);
    expect(graph.maintenanceInterval).toBe(MAINTENANCE_DISABLED);
    expect(graph.bootstrapSweepTrigger).toBeNull();
  });

  it('builds AppModule.forRole("worker") without write/admin/orders controllers and with processor + maintenance', async () => {
    const graph = await inspectModule(AppModule.forRole('worker'));

    expect(graph.controllers.has(CheckoutController)).toBe(false);
    expect(graph.controllers.has(OrdersController)).toBe(false);
    expect(graph.controllers.has(AdminFlashSaleController)).toBe(false);
    expect(graph.controllers.has(HealthController)).toBe(true);
    expect(graph.controllers.has(MetricsController)).toBe(true);
    expect(graph.providers.has(OrderPersistenceProcessor)).toBe(true);
    expect(graph.providers.has(LedgerMaintenanceService)).toBe(true);
    expect(graph.providers.has(FlashSaleHydrationService)).toBe(true);
    expect(graph.maintenanceInterval).toBe(LEDGER_MAINTENANCE_INTERVAL_MS);
    expect(graph.bootstrapSweepTrigger).toBe('INTERVAL');
  });

  it('supports OrdersModule.forRole and AdminModule.forRole directly', async () => {
    expect(OrdersModule.forRole('api').providers).not.toContain(OrderPersistenceProcessor);
    expect(OrdersModule.forRole('worker').controllers).toEqual([]);
    expect(AdminModule.forRole('worker').controllers).toEqual([]);
  });
});
