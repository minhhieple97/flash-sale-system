import type { QUEUE_JOB_STATES } from '../constants/metrics.constants';

export type QueueJobState = (typeof QUEUE_JOB_STATES)[number];

export type QueueJobCountsCollector = () => Promise<Record<string, number>>;
