import type { JobState, Queue } from 'bullmq';
import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { ClockService } from '../../src/common/providers/clock.service';
import type {
  PersistOrderResult,
  ReleaseOutcome,
  ReservationRef,
  ReservationSlot,
} from '../../src/modules/orders/interfaces/order.interface';
import type { OrderCacheRepository } from '../../src/modules/orders/repositories/order-cache.repository';
import type { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import { userIdOf } from './user-id.fixtures';

export const PERSISTENCE_REF: ReservationRef = {
  saleId: 'sale-1',
  userId: userIdOf('alice'),
  orderId: '6f1c1d52-9a3e-4a55-8f45-6a8a1e2b0c11',
};

/** Records the call into `calls`, then resolves with `value`. */
function recorded<T, A extends unknown[]>(calls: string[], name: string, value: T) {
  return jest.fn<Promise<T>, A>(async () => {
    calls.push(name);
    return value;
  });
}

function queueMocks(calls: string[]) {
  return {
    add: jest.fn<Promise<unknown>, unknown[]>(),
    getJob: jest.fn<Promise<unknown>, [string]>(async () => undefined),
    getJobState: jest.fn<Promise<JobState | 'unknown'>, [string]>(async () => 'unknown'),
    pause: recorded<void, []>(calls, 'pause', undefined),
    resume: recorded<void, []>(calls, 'resume', undefined),
    drain: recorded<void, [boolean?]>(calls, 'drain', undefined),
    getActiveCount: jest.fn<Promise<number>, []>(async () => 0),
    close: jest.fn<Promise<void>, []>(),
  };
}

function ordersMocks(calls: string[]) {
  return {
    persistConfirmedOrder: jest.fn<Promise<PersistOrderResult>, [ReservationRef]>(async (ref) => {
      calls.push('persistConfirmedOrder');
      return { outcome: 'INSERTED', orderId: ref.orderId };
    }),
    findConfirmedOrderId: jest.fn<Promise<string | null>, [string, NormalizedUserId]>(
      async () => null,
    ),
    deleteBySale: recorded<number, [string]>(calls, 'deleteBySale', 0),
  };
}

function cacheMocks(calls: string[]) {
  return {
    listReservations: jest.fn<Promise<ReservationRef[]>, [string]>(async () => []),
    findSlot: jest.fn<Promise<ReservationSlot>, [string, NormalizedUserId]>(async () => ({
      status: 'RESERVED',
      orderId: PERSISTENCE_REF.orderId,
    })),
    markConfirmed: recorded<void, [ReservationRef]>(calls, 'markConfirmed', undefined),
    releaseReservation: recorded<ReleaseOutcome, [ReservationRef]>(calls, 'release', 'RELEASED'),
  };
}

export interface PersistenceServiceMocks {
  service: OrderPersistenceService;
  calls: string[];
  queue: ReturnType<typeof queueMocks>;
  orders: ReturnType<typeof ordersMocks>;
  cache: ReturnType<typeof cacheMocks>;
}

/**
 * OrderPersistenceService over jest mocks of the queue and both repositories. Defaults: every queue
 * command succeeds with no active jobs and no job is stored, the sale has no RESERVED entries to
 * reconcile, the slot holds PERSISTENCE_REF as RESERVED, and PostgreSQL holds no order for the user.
 */
export function buildPersistenceService(
  clock: ClockService = new ClockService(),
): PersistenceServiceMocks {
  const calls: string[] = [];
  const queue = queueMocks(calls);
  const orders = ordersMocks(calls);
  const cache = cacheMocks(calls);
  const service = new OrderPersistenceService(
    queue as unknown as Queue<ReservationRef>,
    orders as unknown as OrdersRepository,
    cache as unknown as OrderCacheRepository,
    clock,
  );
  return { service, calls, queue, orders, cache };
}
