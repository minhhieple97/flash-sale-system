import { HttpStatus } from '@nestjs/common';
import type { HealthStatus } from '../interfaces/health.interface';

export const HEALTH_PROBE_TIMEOUT_MS = 1000;
export const DATABASE_PROBE_SQL = 'SELECT 1';
export const REDIS_PING_REPLY = 'PONG';
export const HEALTH_HTTP_STATUS: Readonly<Record<HealthStatus, HttpStatus>> = {
  ok: HttpStatus.OK,
  error: HttpStatus.SERVICE_UNAVAILABLE,
};
