import { Module, type Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ENV_FILE_PATHS } from '../../src/config/config.constants';
import { validateEnv } from '../../src/config/env.schema';
import {
  LEDGER_MAINTENANCE_INTERVAL,
  MAINTENANCE_DISABLED,
} from '../../src/modules/admin/constants/admin.constants';

export const DEFAULT_E2E_ENV_OVERRIDES: Readonly<Record<string, string>> = {
  ENABLE_ADMIN_ENDPOINTS: 'true',
  ADMIN_API_KEY: '',
  RATE_LIMIT_ENABLED: 'false',
  SALE_STARTS_AT: '',
  SALE_ENDS_AT: '',
  SALE_TOTAL_STOCK: '',
  TRUST_PROXY: 'false',
};

export function withIsolatedEnv(
  overrides: Readonly<Record<string, string>> = DEFAULT_E2E_ENV_OVERRIDES,
): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  let restored = false;
  return (): void => {
    if (restored) return;
    restored = true;
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** Builds a fresh ConfigModule evaluated against the current process.env. */
export async function createIsolatedConfigModule(): Promise<Type<unknown>> {
  const configModule = await ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    validate: validateEnv,
    envFilePath: ENV_FILE_PATHS,
  });

  @Module({ imports: [configModule] })
  class IsolatedAppConfigModule {}

  return IsolatedAppConfigModule;
}

/** Dynamically imports AppModule after env isolation and replaces AppConfigModule with a fresh snapshot. */
export async function createIsolatedAppTestingModule(): Promise<TestingModuleBuilder> {
  const isolatedConfig = await createIsolatedConfigModule();
  const [{ AppModule }, { AppConfigModule }] = await Promise.all([
    import('../../src/app.module'),
    import('../../src/config/app-config.module'),
  ]);
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(AppConfigModule)
    .useModule(isolatedConfig)
    .overrideProvider(LEDGER_MAINTENANCE_INTERVAL)
    .useValue(MAINTENANCE_DISABLED);
}
