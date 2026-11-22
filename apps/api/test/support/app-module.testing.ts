import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import {
  LEDGER_MAINTENANCE_INTERVAL,
  MAINTENANCE_DISABLED,
} from '../../src/modules/admin/constants/admin.constants';

export function createAppTestingModule(): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LEDGER_MAINTENANCE_INTERVAL)
    .useValue(MAINTENANCE_DISABLED);
}
