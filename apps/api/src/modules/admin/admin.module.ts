import { type DynamicModule, Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import type { AppRole } from '../../config/env.interface';
import { FlashSalesCoreModule } from '../flash-sales/flash-sales-core.module';
import { OrdersCoreModule } from '../orders/orders.module';
import { ProductsCoreModule } from '../products/products-core.module';
import { SaleLedgerModule } from '../sale-ledger';
import {
  BOOTSTRAP_SWEEP_TRIGGER,
  LEDGER_MAINTENANCE_INTERVAL,
  LEDGER_MAINTENANCE_INTERVAL_MS,
  MAINTENANCE_DISABLED,
} from './constants/admin.constants';
import { AdminFlashSaleController } from './controllers/admin-flash-sale.controller';
import { AdminEndpointsGuard } from './guards/admin-endpoints.guard';
import type { BootstrapSweepTrigger } from './interfaces/admin.interface';
import { FlashSaleHydrationService } from './services/flash-sale-hydration.service';
import { FlashSaleResetService } from './services/flash-sale-reset.service';
import { LedgerMaintenanceService } from './services/ledger-maintenance.service';
import { SaleMutationLock } from './services/sale-mutation-lock.service';

const ADMIN_IMPORTS = [
  CommonModule,
  ProductsCoreModule,
  FlashSalesCoreModule,
  OrdersCoreModule,
  SaleLedgerModule,
];

const ADMIN_CORE_PROVIDERS = [
  SaleMutationLock,
  FlashSaleHydrationService,
  FlashSaleResetService,
  LedgerMaintenanceService,
  AdminEndpointsGuard,
];

const BOOTSTRAP_TRIGGER_BY_ROLE: Readonly<Record<AppRole, BootstrapSweepTrigger>> = {
  all: 'BOOT',
  api: null,
  worker: 'INTERVAL',
};

@Module({})
class AdminRoleModule {}

@Module({
  imports: ADMIN_IMPORTS,
  controllers: [AdminFlashSaleController],
  providers: [
    ...ADMIN_CORE_PROVIDERS,
    { provide: LEDGER_MAINTENANCE_INTERVAL, useValue: LEDGER_MAINTENANCE_INTERVAL_MS },
    { provide: BOOTSTRAP_SWEEP_TRIGGER, useValue: BOOTSTRAP_TRIGGER_BY_ROLE.all },
  ],
})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS DynamicModule factory
export class AdminModule {
  static forRole(role: AppRole): DynamicModule {
    const intervalMs = role === 'api' ? MAINTENANCE_DISABLED : LEDGER_MAINTENANCE_INTERVAL_MS;
    return {
      module: AdminRoleModule,
      imports: ADMIN_IMPORTS,
      controllers: role === 'worker' ? [] : [AdminFlashSaleController],
      providers: [
        ...ADMIN_CORE_PROVIDERS,
        { provide: LEDGER_MAINTENANCE_INTERVAL, useValue: intervalMs },
        { provide: BOOTSTRAP_SWEEP_TRIGGER, useValue: BOOTSTRAP_TRIGGER_BY_ROLE[role] },
      ],
    };
  }
}
