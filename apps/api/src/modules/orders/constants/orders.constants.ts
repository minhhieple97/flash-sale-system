import type { JobsOptions } from 'bullmq';
import type { ReservationRef } from '../interfaces/order.interface';

export const ORDERS_ROUTE = 'orders';
export const USER_ID_PARAM = 'userId';
export const USER_ORDER_ROUTE = `user/:${USER_ID_PARAM}`;

export const ORDER_PERSISTENCE_JOB_NAME = 'persist-order';
export const ORDER_PERSISTENCE_ATTEMPTS = 5;
export const ORDER_PERSISTENCE_BACKOFF_MS = 300;
export const ORDER_PERSISTENCE_CONCURRENCY = 20;
export const ORDER_PERSISTENCE_JOB_OPTIONS = {
  attempts: ORDER_PERSISTENCE_ATTEMPTS,
  backoff: { type: 'exponential', delay: ORDER_PERSISTENCE_BACKOFF_MS },
  removeOnComplete: true,
} as const satisfies JobsOptions;

/**
 * BullMQ 5 rejects custom job ids containing ':' ("Custom Id cannot contain :"), so the spec's
 * `${saleId}:${userId}` would fail every enqueue. The orderId is unique per reservation: it still
 * dedupes a repeated enqueue of one reservation, and it cannot collide with the same user's next
 * reservation after an admin reset or a compensation.
 */
export const orderPersistenceJobId = (ref: ReservationRef): string => ref.orderId;

export const CONFIRMED_ORDER_STATUS = 'CONFIRMED';
export const STOCK_INVARIANT_VIOLATION_MESSAGE =
  'Persisting the order would drive flash_sales.remaining_stock below zero';
export const ORDER_SALE_NOT_FOUND_MESSAGE =
  'Cannot persist an order for a flash sale that does not exist';
