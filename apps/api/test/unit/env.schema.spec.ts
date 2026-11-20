import { validateEnv } from '../../src/config/env.schema';

const REQUIRED = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'u',
  POSTGRES_PASSWORD: 'p',
  POSTGRES_DB: 'db',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
};

describe('validateEnv', () => {
  it('parses a complete environment into numbers and booleans', () => {
    const env = validateEnv({
      ...REQUIRED,
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      PORT: '4000',
      ENABLE_ADMIN_ENDPOINTS: 'false',
      RATE_LIMIT_ENABLED: 'true',
    });

    expect(env).toMatchObject({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      PORT: 4000,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: 5432,
      REDIS_PORT: 6380,
      ENABLE_ADMIN_ENDPOINTS: false,
      RATE_LIMIT_ENABLED: true,
    });
  });

  it('applies defaults when optional variables are absent', () => {
    const env = validateEnv({ ...REQUIRED });

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: 3000,
      ENABLE_ADMIN_ENDPOINTS: true,
      RATE_LIMIT_ENABLED: false,
    });
  });

  it('parses the string "false" to boolean false', () => {
    const env = validateEnv({ ...REQUIRED, ENABLE_ADMIN_ENDPOINTS: 'false' });

    expect(env.ENABLE_ADMIN_ENDPOINTS).toBe(false);
  });

  it('throws naming a missing required variable', () => {
    const { POSTGRES_HOST: _omitted, ...rest } = REQUIRED;

    expect(() => validateEnv(rest)).toThrow(/POSTGRES_HOST/);
  });

  it.each([
    ['REDIS_PORT', 'abc'],
    ['REDIS_PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['ENABLE_ADMIN_ENDPOINTS', 'yes'],
  ])('throws naming %s when it is %s', (name, value) => {
    expect(() => validateEnv({ ...REQUIRED, [name]: value })).toThrow(new RegExp(name));
  });
});
