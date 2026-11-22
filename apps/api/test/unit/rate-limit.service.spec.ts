import type { ConfigService } from '@nestjs/config';
import { RATE_LIMIT_MAX_BUCKETS } from '../../src/common/constants/common.constants';
import type { ClockService } from '../../src/common/providers/clock.service';
import { RateLimitService } from '../../src/common/services/rate-limit.service';
import type { AppEnv } from '../../src/config/env.interface';

function buildService(options?: { windowMs?: number; max?: number }) {
  let nowMs = 1_700_000_000_000;
  const values = {
    RATE_LIMIT_WINDOW_MS: options?.windowMs ?? 60_000,
    RATE_LIMIT_MAX: options?.max ?? 3,
  };
  const config = {
    get: jest.fn((key: keyof typeof values) => values[key]),
  } as unknown as ConfigService<AppEnv, true>;
  const clock = { nowMs: () => nowMs } as ClockService;
  const service = new RateLimitService(config, clock);
  return {
    service,
    advanceMs: (ms: number): void => {
      nowMs += ms;
    },
  };
}

describe('RateLimitService', () => {
  it('allows requests up to the configured limit and decrements remaining', () => {
    const { service } = buildService({ windowMs: 10_000, max: 3 });

    expect(service.consume('POST:/api/v1/checkout/purchase:1.2.3.4')).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetAtMs: 1_700_000_010_000,
    });
    expect(service.consume('POST:/api/v1/checkout/purchase:1.2.3.4')).toEqual({
      allowed: true,
      limit: 3,
      remaining: 1,
      resetAtMs: 1_700_000_010_000,
    });
    expect(service.consume('POST:/api/v1/checkout/purchase:1.2.3.4')).toEqual({
      allowed: true,
      limit: 3,
      remaining: 0,
      resetAtMs: 1_700_000_010_000,
    });
  });

  it('denies requests above the limit with rounded-up retryAfterSeconds', () => {
    const { service, advanceMs } = buildService({ windowMs: 10_000, max: 1 });
    service.consume('GET:/api/v1/orders/user/:userId:1.2.3.4');

    advanceMs(2_100);
    const denied = service.consume('GET:/api/v1/orders/user/:userId:1.2.3.4');

    expect(denied).toEqual({
      allowed: false,
      limit: 1,
      retryAfterSeconds: 8,
      resetAtMs: 1_700_000_010_000,
    });
  });

  it('opens a fresh window once the current window expires', () => {
    const { service, advanceMs } = buildService({ windowMs: 5_000, max: 1 });
    service.consume('k1');
    expect(service.consume('k1').allowed).toBe(false);

    advanceMs(5_000);
    expect(service.consume('k1')).toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
      resetAtMs: 1_700_000_010_000,
    });
  });

  it('isolates distinct keys', () => {
    const { service } = buildService({ windowMs: 5_000, max: 1 });
    expect(service.consume('ip-1').allowed).toBe(true);
    expect(service.consume('ip-2').allowed).toBe(true);
    expect(service.consume('ip-1').allowed).toBe(false);
  });

  it('sweeps expired buckets before evicting active buckets at capacity', () => {
    const { service, advanceMs } = buildService({ windowMs: 5_000, max: 2 });
    for (let i = 0; i < RATE_LIMIT_MAX_BUCKETS - 1; i += 1) {
      service.consume(`expired:${i}`);
    }
    advanceMs(3_000);
    service.consume('active-key');

    advanceMs(2_500);
    const result = service.consume('brand-new');

    expect(result.allowed).toBe(true);
    expect(service.consume('active-key')).toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      resetAtMs: 1_700_000_008_000,
    });
  });

  it('evicts the oldest bucket when all buckets are still active at capacity', () => {
    const { service } = buildService({ windowMs: 60_000, max: 2 });
    for (let i = 0; i < RATE_LIMIT_MAX_BUCKETS; i += 1) {
      service.consume(`k:${i}`);
    }

    expect(service.consume('k:overflow')).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAtMs: 1_700_000_060_000,
    });
    expect(service.consume('k:0')).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAtMs: 1_700_000_060_000,
    });
  });

  it('skips scanning buckets when all entries at capacity are still active', () => {
    const { service } = buildService({ windowMs: 60_000, max: 2 });
    for (let i = 0; i < RATE_LIMIT_MAX_BUCKETS; i += 1) {
      service.consume(`active:${i}`);
    }
    const entriesSpy = jest.spyOn(Map.prototype, 'entries');

    try {
      service.consume('active:overflow');
      expect(entriesSpy).not.toHaveBeenCalled();
    } finally {
      entriesSpy.mockRestore();
    }
  });

  it('stops sweeping at the first unexpired bucket when older entries expired', () => {
    const { service, advanceMs } = buildService({ windowMs: 5_000, max: 2 });
    service.consume('expired:0');
    service.consume('expired:1');
    advanceMs(3_000);
    for (let i = 0; i < RATE_LIMIT_MAX_BUCKETS - 2; i += 1) {
      service.consume(`fresh:${i}`);
    }
    advanceMs(2_500);
    const origEntries = Map.prototype.entries;
    let yielded = 0;
    const entriesSpy = jest.spyOn(Map.prototype, 'entries').mockImplementation(function (
      this: Map<unknown, unknown>,
    ) {
      const iter = origEntries.call(this);
      const origNext = iter.next.bind(iter);
      iter.next = () => {
        yielded += 1;
        return origNext();
      };
      return iter;
    });

    try {
      const result = service.consume('brand-new');
      expect(result.allowed).toBe(true);
      expect(yielded).toBe(3);
      expect(service.consume('fresh:0')).toMatchObject({ allowed: true, remaining: 0 });
    } finally {
      entriesSpy.mockRestore();
    }
  });
});
