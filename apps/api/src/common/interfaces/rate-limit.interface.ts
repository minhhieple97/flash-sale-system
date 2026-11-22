export interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

export type RateLimitDecision =
  | {
      allowed: true;
      limit: number;
      remaining: number;
      resetAtMs: number;
    }
  | {
      allowed: false;
      limit: number;
      retryAfterSeconds: number;
      resetAtMs: number;
    };
