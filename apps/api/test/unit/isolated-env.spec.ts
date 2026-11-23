import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AppEnv } from '../../src/config/env.interface';
import { startE2eApp } from '../support/e2e-app.harness';
import {
  createIsolatedConfigModule,
  DEFAULT_E2E_ENV_OVERRIDES,
  withIsolatedEnv,
} from '../support/isolated-env';
import { createRealSaleHarness } from '../support/real-sale.harness';

@Injectable()
class EnvReader {
  constructor(readonly config: ConfigService<AppEnv, true>) {}
}

describe('isolated-env', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('exports the expected default E2E env overrides', () => {
    expect(DEFAULT_E2E_ENV_OVERRIDES).toEqual({
      ENABLE_ADMIN_ENDPOINTS: 'true',
      ADMIN_API_KEY: '',
      RATE_LIMIT_ENABLED: 'false',
      SALE_STARTS_AT: '',
      SALE_ENDS_AT: '',
      SALE_TOTAL_STOCK: '',
      TRUST_PROXY: 'false',
    });
  });

  it('applies defaults and restores both originally-set and originally-unset keys', () => {
    process.env.ENABLE_ADMIN_ENDPOINTS = 'false';
    process.env.ADMIN_API_KEY = 'prod-secret';
    process.env.RATE_LIMIT_ENABLED = 'true';
    delete process.env.SALE_STARTS_AT;
    delete process.env.SALE_ENDS_AT;
    delete process.env.SALE_TOTAL_STOCK;
    delete process.env.TRUST_PROXY;

    const restore = withIsolatedEnv();

    expect(process.env.ENABLE_ADMIN_ENDPOINTS).toBe('true');
    expect(process.env.ADMIN_API_KEY).toBe('');
    expect(process.env.RATE_LIMIT_ENABLED).toBe('false');
    expect(process.env.SALE_STARTS_AT).toBe('');
    expect(process.env.SALE_ENDS_AT).toBe('');
    expect(process.env.SALE_TOTAL_STOCK).toBe('');
    expect(process.env.TRUST_PROXY).toBe('false');

    restore();

    expect(process.env.ENABLE_ADMIN_ENDPOINTS).toBe('false');
    expect(process.env.ADMIN_API_KEY).toBe('prod-secret');
    expect(process.env.RATE_LIMIT_ENABLED).toBe('true');
    expect(process.env.SALE_STARTS_AT).toBeUndefined();
    expect(process.env.SALE_ENDS_AT).toBeUndefined();
    expect(process.env.SALE_TOTAL_STOCK).toBeUndefined();
    expect(process.env.TRUST_PROXY).toBeUndefined();
  });

  it('restores custom overrides cleanly and makes restore idempotent', () => {
    const customKey = 'TEST_ISOLATED_ENV_TEMP_KEY';
    delete process.env[customKey];

    const restore = withIsolatedEnv({ [customKey]: 'temporary' });
    expect(process.env[customKey]).toBe('temporary');

    restore();
    expect(process.env[customKey]).toBeUndefined();

    process.env[customKey] = 'later-value';
    restore();
    expect(process.env[customKey]).toBe('later-value');
  });

  it('re-evaluates ConfigModule against isolated process.env when overriding AppConfigModule', async () => {
    const restoreBase = withIsolatedEnv({
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'flash_sale',
      POSTGRES_PASSWORD: 'flash_sale',
      POSTGRES_DB: 'flash_sale',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      ENABLE_ADMIN_ENDPOINTS: 'false',
      ADMIN_API_KEY: 'polluted-key',
      RATE_LIMIT_ENABLED: 'true',
      TRUST_PROXY: 'true',
    });
    const { AppConfigModule } = await import('../../src/config/app-config.module');
    const restoreIsolated = withIsolatedEnv(DEFAULT_E2E_ENV_OVERRIDES);

    try {
      @Module({ imports: [AppConfigModule], providers: [EnvReader] })
      class ConsumerModule {}

      const moduleRef = await Test.createTestingModule({ imports: [ConsumerModule] })
        .overrideModule(AppConfigModule)
        .useModule(await createIsolatedConfigModule())
        .compile();
      const { config } = moduleRef.get(EnvReader);

      expect(config.get('ENABLE_ADMIN_ENDPOINTS', { infer: true })).toBe(true);
      expect(config.get('ADMIN_API_KEY', { infer: true })).toBe('');
      expect(config.get('RATE_LIMIT_ENABLED', { infer: true })).toBe(false);
      expect(config.get('TRUST_PROXY', { infer: true })).toBe(false);
      await moduleRef.close();
    } finally {
      restoreIsolated();
      restoreBase();
    }
  });

  it('restores process.env when startE2eApp fails before returning', async () => {
    process.env.ADMIN_API_KEY = 'keep-me';
    process.env.RATE_LIMIT_ENABLED = 'true';

    await expect(startE2eApp({ POSTGRES_PORT: 'not-a-port' })).rejects.toThrow(/POSTGRES_PORT/);

    expect(process.env.ADMIN_API_KEY).toBe('keep-me');
    expect(process.env.RATE_LIMIT_ENABLED).toBe('true');
  });

  it('restores process.env when createRealSaleHarness fails before returning', async () => {
    process.env.SALE_TOTAL_STOCK = '42';
    process.env.ADMIN_API_KEY = 'keep-me';

    await expect(createRealSaleHarness({ POSTGRES_PORT: 'not-a-port' })).rejects.toThrow(
      /POSTGRES_PORT/,
    );

    expect(process.env.SALE_TOTAL_STOCK).toBe('42');
    expect(process.env.ADMIN_API_KEY).toBe('keep-me');
  });
});
