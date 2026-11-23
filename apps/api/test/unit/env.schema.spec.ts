import { parseAppRole, parseTrustProxy, validateEnv } from '../../src/config/env.schema';

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
      ENABLE_ADMIN_ENDPOINTS: 'true',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      PORT: 4000,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: 5432,
      REDIS_PORT: 6380,
      ENABLE_ADMIN_ENDPOINTS: true,
    });
  });

  it('applies defaults when optional variables are absent', () => {
    const env = validateEnv({ ...REQUIRED });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      APP_ROLE: 'all',
      LOG_LEVEL: 'info',
      PORT: 3000,
      TRUST_PROXY: false,
      RATE_LIMIT_ENABLED: false,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX: 60,
    });
    expect(env.ADMIN_API_KEY).toBeUndefined();
  });

  it('keeps the unauthenticated admin endpoints off when ENABLE_ADMIN_ENDPOINTS is unset', () => {
    expect(validateEnv({ ...REQUIRED }).ENABLE_ADMIN_ENDPOINTS).toBe(false);
  });

  it('parses the string "false" to boolean false', () => {
    expect(
      validateEnv({ ...REQUIRED, ENABLE_ADMIN_ENDPOINTS: 'false' }).ENABLE_ADMIN_ENDPOINTS,
    ).toBe(false);
  });

  it('throws naming a missing required variable', () => {
    const { POSTGRES_HOST: _omitted, ...rest } = REQUIRED;
    expect(() => validateEnv(rest)).toThrow(/POSTGRES_HOST/);
  });

  it.each([
    ['REDIS_PORT', 'abc'],
    ['REDIS_PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['LOG_LEVEL', ''],
    ['ENABLE_ADMIN_ENDPOINTS', 'yes'],
    ['APP_ROLE', 'scheduler'],
    ['APP_ROLE', ''],
    ['TRUST_PROXY', 'yes'],
    ['RATE_LIMIT_ENABLED', 'yes'],
    ['RATE_LIMIT_WINDOW_MS', '999'],
    ['RATE_LIMIT_WINDOW_MS', '3600001'],
    ['RATE_LIMIT_WINDOW_MS', 'abc'],
    ['RATE_LIMIT_MAX', '0'],
    ['RATE_LIMIT_MAX', '100001'],
    ['DATABASE_POOL_MAX', '0'],
    ['DATABASE_POOL_MAX', '201'],
    ['DATABASE_POOL_MAX', '-1'],
    ['DATABASE_POOL_MAX', '2.5'],
    ['DATABASE_POOL_MAX', 'abc'],
  ])('throws naming %s when it is %s', (name, value) => {
    expect(() => validateEnv({ ...REQUIRED, [name]: value })).toThrow(new RegExp(name));
  });

  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const)(
    'accepts valid LOG_LEVEL %s',
    (level) => expect(validateEnv({ ...REQUIRED, LOG_LEVEL: level }).LOG_LEVEL).toBe(level),
  );

  it('parses optional DATABASE_POOL_MAX and treats empty string as undefined', () => {
    expect(validateEnv({ ...REQUIRED }).DATABASE_POOL_MAX).toBeUndefined();
    expect(validateEnv({ ...REQUIRED, DATABASE_POOL_MAX: '' }).DATABASE_POOL_MAX).toBeUndefined();
    expect(validateEnv({ ...REQUIRED, DATABASE_POOL_MAX: '1' }).DATABASE_POOL_MAX).toBe(1);
    expect(validateEnv({ ...REQUIRED, DATABASE_POOL_MAX: '200' }).DATABASE_POOL_MAX).toBe(200);
  });

  describe('sale window variables', () => {
    it('keeps the sale variables undefined when they are absent or empty', () => {
      const env = validateEnv({ ...REQUIRED, SALE_STARTS_AT: '', SALE_ENDS_AT: '' });
      expect([env.SALE_STARTS_AT, env.SALE_ENDS_AT, env.SALE_TOTAL_STOCK]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('parses a complete sale window', () => {
      const env = validateEnv({
        ...REQUIRED,
        SALE_STARTS_AT: '2030-01-01T00:00:00Z',
        SALE_ENDS_AT: '2030-01-01T01:00:00Z',
        SALE_TOTAL_STOCK: '25',
      });
      expect(env).toMatchObject({
        SALE_STARTS_AT: '2030-01-01T00:00:00Z',
        SALE_ENDS_AT: '2030-01-01T01:00:00Z',
        SALE_TOTAL_STOCK: 25,
      });
    });

    it('rejects SALE_ENDS_AT that is not after SALE_STARTS_AT', () => {
      const raw = {
        ...REQUIRED,
        SALE_STARTS_AT: '2030-01-01T01:00:00Z',
        SALE_ENDS_AT: '2030-01-01T01:00:00Z',
      };
      expect(() => validateEnv(raw)).toThrow(/SALE_ENDS_AT/);
    });

    const VALID_START = '2030-01-01T00:00:00Z';
    const VALID_END = '2030-01-01T01:00:00Z';

    it.each([
      ['SALE_STARTS_AT', 'tomorrow noon'],
      ['SALE_STARTS_AT', '2026-W47'],
      ['SALE_STARTS_AT', '2026-325'],
      ['SALE_STARTS_AT', '20261121T100000Z'],
      ['SALE_STARTS_AT', '2030-01-01T10:00:00'],
      ['SALE_STARTS_AT', '2030-01-01'],
      ['SALE_STARTS_AT', '2030-01-01 10:00:00Z'],
      ['SALE_STARTS_AT', '2030-01-01T10:00:00+25:00'],
      ['SALE_STARTS_AT', '2030-02-30T10:00:00Z'],
      ['SALE_ENDS_AT', '2030-13-45T00:00:00Z'],
    ])('rejects %s when it is not an RFC 3339 timestamp with a zone (%s)', (name, value) => {
      const raw = { ...REQUIRED, SALE_STARTS_AT: VALID_START, SALE_ENDS_AT: VALID_END };
      expect(() => validateEnv({ ...raw, [name]: value })).toThrow(
        new RegExp(`${name} must be an RFC 3339 timestamp`),
      );
    });

    it.each(['2030-01-01T00:00:00Z', '2030-01-01T07:00:00+07:00', '2030-01-01T00:00:00.250-00:30'])(
      'accepts the zoned timestamp %s',
      (value) => {
        const raw = { ...REQUIRED, SALE_STARTS_AT: value, SALE_ENDS_AT: '2031-01-01T00:00:00Z' };
        expect(validateEnv(raw).SALE_STARTS_AT).toBe(value);
      },
    );

    it.each([
      ['SALE_STARTS_AT', 'SALE_ENDS_AT', VALID_START],
      ['SALE_ENDS_AT', 'SALE_STARTS_AT', VALID_END],
    ])('rejects %s without %s, naming the missing variable', (set, missing, value) => {
      expect(() => validateEnv({ ...REQUIRED, [set]: value })).toThrow(
        new RegExp(`${missing} must be set together with ${set}`),
      );
    });

    it('treats an empty variable as unset when checking the pair', () => {
      const raw = { ...REQUIRED, SALE_STARTS_AT: VALID_START, SALE_ENDS_AT: '' };
      expect(() => validateEnv(raw)).toThrow(
        /SALE_ENDS_AT must be set together with SALE_STARTS_AT/,
      );
    });

    it('accepts a window that is already over, since a past sale is a legitimate sale', () => {
      const env = validateEnv({
        ...REQUIRED,
        SALE_STARTS_AT: '2020-01-01T00:00:00Z',
        SALE_ENDS_AT: '2020-01-01T01:00:00Z',
      });
      expect(env.SALE_ENDS_AT).toBe('2020-01-01T01:00:00Z');
    });

    it.each(['0', '-3', '2.5', 'many', '1000001', '3000000000', '99999999999999999999'])(
      'rejects SALE_TOTAL_STOCK %s',
      (value) =>
        expect(() => validateEnv({ ...REQUIRED, SALE_TOTAL_STOCK: value })).toThrow(
          /SALE_TOTAL_STOCK/,
        ),
    );

    it('accepts SALE_TOTAL_STOCK up to the reset cap of 1000000', () => {
      expect(validateEnv({ ...REQUIRED, SALE_TOTAL_STOCK: '1000000' }).SALE_TOTAL_STOCK).toBe(
        1_000_000,
      );
    });
  });

  describe('role, admin key and rate limit variables', () => {
    it('parses valid values and treats an empty ADMIN_API_KEY as unset', () => {
      expect(
        validateEnv({
          ...REQUIRED,
          APP_ROLE: 'api',
          ADMIN_API_KEY: 'super-secret',
          TRUST_PROXY: 'true',
          RATE_LIMIT_ENABLED: 'true',
          RATE_LIMIT_WINDOW_MS: '1000',
          RATE_LIMIT_MAX: '100000',
        }),
      ).toMatchObject({
        APP_ROLE: 'api',
        ADMIN_API_KEY: 'super-secret',
        TRUST_PROXY: true,
        RATE_LIMIT_ENABLED: true,
        RATE_LIMIT_WINDOW_MS: 1000,
        RATE_LIMIT_MAX: 100_000,
      });
      const blankKey = validateEnv({ ...REQUIRED, APP_ROLE: 'worker', ADMIN_API_KEY: '' });
      expect([blankKey.APP_ROLE, blankKey.ADMIN_API_KEY]).toEqual(['worker', undefined]);
    });

    it('parses APP_ROLE and TRUST_PROXY helpers and rejects invalid values', () => {
      for (const [raw, expected] of [
        [undefined, 'all'],
        ['', 'all'],
        ['all', 'all'],
        ['api', 'api'],
        ['worker', 'worker'],
      ] as const) {
        expect(parseAppRole(raw)).toBe(expected);
      }
      expect(() => parseAppRole('scheduler')).toThrow(/APP_ROLE/);
      for (const [raw, expected] of [
        [undefined, false],
        ['', false],
        ['false', false],
        ['true', true],
      ] as const) {
        expect(parseTrustProxy(raw)).toBe(expected);
      }
      expect(() => parseTrustProxy('yes')).toThrow(/TRUST_PROXY/);
    });
  });
});
