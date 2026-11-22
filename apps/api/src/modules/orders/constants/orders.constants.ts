import type { JobState, JobsOptions } from 'bullmq';
import type { ReservationRef } from '../../sale-ledger';
import type { OrphanStrikes, SweepTrigger } from '../interfaces/order.interface';

export const ORDERS_ROUTE = 'orders';
export const USER_ID_PARAM = 'userId';
export const USER_ORDER_ROUTE = `user/:${USER_ID_PARAM}`;

export const ORDER_PERSISTENCE_JOB_NAME = 'persist-order';
export const ORDER_PERSISTENCE_CONCURRENCY = 20;
export const ORDER_PERSISTENCE_ATTEMPTS = 150;
export const ORDER_PERSISTENCE_RETRY_DELAY_MS = 2_000;
export const ORDER_PERSISTENCE_FAILED_JOB_MAX_AGE_SECONDS = 86_400;
export const ORDER_PERSISTENCE_JOB_OPTIONS = {
  attempts: ORDER_PERSISTENCE_ATTEMPTS,
  backoff: { type: 'fixed', delay: ORDER_PERSISTENCE_RETRY_DELAY_MS },
  removeOnComplete: true,
  removeOnFail: { age: ORDER_PERSISTENCE_FAILED_JOB_MAX_AGE_SECONDS },
} satisfies JobsOptions;

/**
 * BullMQ 5 rejects custom job ids containing ':' ("Custom Id cannot contain :"), so
 * `${saleId}:${userId}` would fail every enqueue. The orderId is unique per reservation: it still
 * dedupes a repeated enqueue of one reservation, and it cannot collide with the same user's next
 * reservation after an admin reset or a compensation.
 */
export const orderPersistenceJobId = (ref: ReservationRef): string => ref.orderId;

export const ORDER_COMPENSATION_JOB_NAME = 'compensate-order';
export const ORDER_COMPENSATION_ATTEMPTS = 8;
export const ORDER_COMPENSATION_BACKOFF_MS = 1000;
export const ORDER_COMPENSATION_JOB_OPTIONS = {
  attempts: ORDER_COMPENSATION_ATTEMPTS,
  backoff: { type: 'exponential', delay: ORDER_COMPENSATION_BACKOFF_MS },
  removeOnComplete: true,
  removeOnFail: { age: ORDER_PERSISTENCE_FAILED_JOB_MAX_AGE_SECONDS },
} as const satisfies JobsOptions;
/** Same ':' restriction as the persistence job id; the prefix keeps the two ids apart. */
export const orderCompensationJobId = (ref: ReservationRef): string => `compensate-${ref.orderId}`;

/**
 * Job states from which a job can still run. `completed` jobs are removed (`removeOnComplete`) and
 * read as `unknown`; `failed` means the retries are spent.
 */
export const PENDING_JOB_STATES: ReadonlySet<JobState | 'unknown'> = new Set([
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
]);

export const STRIKES_TO_COMPENSATE = { BOOT: 1, INTERVAL: 2 } as const satisfies Record<
  SweepTrigger,
  number
>;
export const NO_STRIKES: OrphanStrikes = new Map();

/** An admin reset waits this long for in-flight persistence jobs before answering 503. */
export const RESET_ACTIVE_JOBS_POLL_MS = 25;
export const RESET_ACTIVE_JOBS_TIMEOUT_MS = 10_000;

export const CONFIRMED_ORDER_STATUS = 'CONFIRMED';
