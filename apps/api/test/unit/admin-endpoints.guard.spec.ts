import {
  type ExecutionContext,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../src/config/env.interface';
import {
  ADMIN_ENDPOINTS_DISABLED_MESSAGE,
  UNSUPPORTED_MEDIA_TYPE_CODE,
  UNSUPPORTED_MEDIA_TYPE_MESSAGE,
} from '../../src/modules/admin/constants/admin.constants';
import { AdminEndpointsGuard } from '../../src/modules/admin/guards/admin-endpoints.guard';

function mockConfig(overrides: Partial<AppEnv> = {}): ConfigService<AppEnv, true> {
  const env: Partial<AppEnv> = {
    NODE_ENV: 'development',
    ENABLE_ADMIN_ENDPOINTS: true,
    ADMIN_API_KEY: undefined,
    ...overrides,
  };
  return { get: (key: keyof AppEnv) => env[key] } as unknown as ConfigService<AppEnv, true>;
}

function mockContext(method = 'POST', headers: Record<string, string | string[] | undefined> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminEndpointsGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws 404 when admin endpoints are disabled', () => {
    const guard = new AdminEndpointsGuard(
      mockConfig({ ENABLE_ADMIN_ENDPOINTS: false, ADMIN_API_KEY: 'secret' }),
    );

    expect(() =>
      guard.canActivate(mockContext('POST', { 'content-type': 'application/json' })),
    ).toThrow(new NotFoundException(ADMIN_ENDPOINTS_DISABLED_MESSAGE));
  });

  it.each([
    ['missing content-type', undefined],
    ['text/plain', 'text/plain'],
    ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded'],
    ['array header', ['application/json']],
  ])('throws 415 on POST with %s', (_label, contentType) => {
    const guard = new AdminEndpointsGuard(mockConfig());
    const headers = contentType === undefined ? {} : { 'content-type': contentType };

    try {
      guard.canActivate(mockContext('POST', headers));
      throw new Error('Expected UnsupportedMediaTypeException');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
      expect((error as UnsupportedMediaTypeException).getResponse()).toMatchObject({
        code: UNSUPPORTED_MEDIA_TYPE_CODE,
        message: UNSUPPORTED_MEDIA_TYPE_MESSAGE,
      });
    }
  });

  it.each(['application/json', 'Application/JSON; charset=utf-8'])(
    'allows POST with %s when ADMIN_API_KEY is unset',
    (contentType) => {
      const guard = new AdminEndpointsGuard(mockConfig());

      expect(guard.canActivate(mockContext('POST', { 'content-type': contentType }))).toBe(true);
    },
  );

  it('allows non-POST requests without requiring application/json', () => {
    const guard = new AdminEndpointsGuard(mockConfig());

    expect(guard.canActivate(mockContext('GET', {}))).toBe(true);
  });

  it.each([undefined, 'wrong', 'secretX'])(
    'throws 401 when ADMIN_API_KEY is set and x-admin-key is %s',
    (providedKey) => {
      const guard = new AdminEndpointsGuard(mockConfig({ ADMIN_API_KEY: 'secret' }));
      const headers =
        providedKey === undefined
          ? { 'content-type': 'application/json' }
          : { 'content-type': 'application/json', 'x-admin-key': providedKey };

      expect(() => guard.canActivate(mockContext('POST', headers))).toThrow(UnauthorizedException);
    },
  );

  it('allows POST when ADMIN_API_KEY matches and content-type is application/json', () => {
    const guard = new AdminEndpointsGuard(mockConfig({ ADMIN_API_KEY: 'secret' }));

    expect(
      guard.canActivate(
        mockContext('POST', { 'content-type': 'application/json', 'x-admin-key': 'secret' }),
      ),
    ).toBe(true);
  });

  it('warns once on module init when enabled in production without ADMIN_API_KEY', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const guard = new AdminEndpointsGuard(
      mockConfig({ NODE_ENV: 'production', ENABLE_ADMIN_ENDPOINTS: true, ADMIN_API_KEY: '' }),
    );

    guard.onModuleInit();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('ADMIN_API_KEY');
  });

  it.each([
    { NODE_ENV: 'development' as const, ENABLE_ADMIN_ENDPOINTS: true, ADMIN_API_KEY: undefined },
    { NODE_ENV: 'production' as const, ENABLE_ADMIN_ENDPOINTS: false, ADMIN_API_KEY: undefined },
    { NODE_ENV: 'production' as const, ENABLE_ADMIN_ENDPOINTS: true, ADMIN_API_KEY: 'secret' },
  ])('does not warn on module init for %j', (overrides) => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const guard = new AdminEndpointsGuard(mockConfig(overrides));

    guard.onModuleInit();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
