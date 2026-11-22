import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.interface';
import { RATE_LIMIT_MAX_BUCKETS } from '../constants/common.constants';
import type { RateLimitBucket, RateLimitDecision } from '../interfaces/rate-limit.interface';
import { ClockService } from '../providers/clock.service';

const MS_PER_SECOND = 1_000;

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly clock: ClockService,
  ) {}

  consume(key: string): RateLimitDecision {
    const nowMs = this.clock.nowMs();
    const limit = this.config.get('RATE_LIMIT_MAX', { infer: true });
    const existing = this.buckets.get(key);
    if (existing !== undefined && existing.resetAtMs > nowMs) {
      return this.incrementBucket(existing, limit, nowMs);
    }
    if (existing !== undefined) this.buckets.delete(key);
    this.makeRoom(nowMs);
    const resetAtMs = nowMs + this.config.get('RATE_LIMIT_WINDOW_MS', { infer: true });
    this.buckets.set(key, { count: 1, resetAtMs });
    return { allowed: true, limit, remaining: Math.max(0, limit - 1), resetAtMs };
  }

  private incrementBucket(
    bucket: RateLimitBucket,
    limit: number,
    nowMs: number,
  ): RateLimitDecision {
    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / MS_PER_SECOND));
      return { allowed: false, limit, retryAfterSeconds, resetAtMs: bucket.resetAtMs };
    }
    bucket.count += 1;
    return {
      allowed: true,
      limit,
      remaining: limit - bucket.count,
      resetAtMs: bucket.resetAtMs,
    };
  }

  private makeRoom(nowMs: number): void {
    if (this.buckets.size < RATE_LIMIT_MAX_BUCKETS) return;
    const oldest = this.buckets.values().next().value;
    if (oldest !== undefined && oldest.resetAtMs <= nowMs) {
      this.sweepExpired(nowMs);
    }
    while (this.buckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) return;
      this.buckets.delete(oldestKey);
    }
  }

  private sweepExpired(nowMs: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAtMs > nowMs) break;
      this.buckets.delete(key);
    }
  }
}
