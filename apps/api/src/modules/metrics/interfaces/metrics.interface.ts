import type { DB_POOL_STATES, QUEUE_JOB_STATES } from '../constants/metrics.constants';

export type QueueJobState = (typeof QUEUE_JOB_STATES)[number];

export type QueueJobCountsCollector = () => Promise<Record<string, number>>;

export type DbPoolState = (typeof DB_POOL_STATES)[number];

export type DbPoolCounts = Readonly<Record<DbPoolState, number>>;

export type DbPoolCountsCollector = () => DbPoolCounts | null | Promise<DbPoolCounts | null>;

export interface HttpDurationObservation {
  readonly method: string;
  readonly route?: string;
  readonly statusCode: number;
  readonly durationSeconds: number;
}
