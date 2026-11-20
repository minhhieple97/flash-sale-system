import type { Config } from 'jest';

const INTEGRATION_TIMEOUT_MS = 20000;
const shared = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
} satisfies Config;

const config: Config = {
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...shared,
      displayName: 'integration',
      testMatch: [
        '<rootDir>/test/integration/**/*.spec.ts',
        '<rootDir>/test/integration/**/*.e2e-spec.ts',
      ],
      setupFiles: ['<rootDir>/test/support/integration.setup.ts'],
      testTimeout: INTEGRATION_TIMEOUT_MS,
    },
  ],
};

export default config;
