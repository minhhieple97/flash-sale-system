import type { JobState, Queue } from 'bullmq';
import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { ClockService } from '../../src/common/providers/clock.service';
import type { MetricsService } from '../../src/modules/metrics/services/metrics.service';
import type { PersistOrderResult } from '../../src/modules/orders/interfaces/order.interface';
import type { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository';
import { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type {
  AdoptOutcome,
  ConfirmOutcome,
  ReleaseOutcome,
  ReservationRef,
  ReservationSlot,
  SaleLedgerRepository,
} from '../../src/modules/sale-ledger';
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
    getJobCounts: jest.fn<Promise<Record<string, number>>, string[]>(async () => ({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    })),
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
  };
}

function cacheMocks(calls: string[]) {
  return {
    listReservations: jest.fn<Promise<ReservationRef[]>, [string]>(async () => []),
    findSlot: jest.fn<Promise<ReservationSlot>, [string, NormalizedUserId]>(async () => ({
      status: 'RESERVED',
      orderId: PERSISTENCE_REF.orderId,
    })),
    confirmReservation: recorded<ConfirmOutcome, [ReservationRef, string]>(
      calls,
      'confirmReservation',
      'CONFIRMED',
    ),
    releaseReservation: recorded<ReleaseOutcome, [ReservationRef]>(calls, 'release', 'RELEASED'),
    adoptCommittedOrder: recorded<AdoptOutcome, [ReservationRef]>(calls, 'adopt', 'NOT_ADOPTED'),
    isIntact: jest.fn<Promise<boolean>, [string]>(async () => true),
  };
}

export interface PersistenceServiceMocks {
  service: OrderPersistenceService;
  calls: string[];
  queue: ReturnType<typeof queueMocks>;
  orders: ReturnType<typeof ordersMocks>;
  cache: ReturnType<typeof cacheMocks>;
}

export function buildPersistenceService(
  clock: ClockService = new ClockService(),
  metrics?: MetricsService,
): PersistenceServiceMocks {
  const calls: string[] = [];
  const queue = queueMocks(calls);
  const orders = ordersMocks(calls);
  const cache = cacheMocks(calls);
  const service = new OrderPersistenceService(
    queue as unknown as Queue<ReservationRef>,
    orders as unknown as OrdersRepository,
    cache as unknown as SaleLedgerRepository,
    clock,
    metrics,
  );
  return { service, calls, queue, orders, cache };
}

export function buildPersistenceWithMetrics() {
  const recordOrderPersistence = jest.fn<void, [string]>();
  const registerQueueCollector = jest.fn<void, [() => Promise<Record<string, number>>]>();
  const metrics = { recordOrderPersistence, registerQueueCollector } as unknown as MetricsService;
  const built = buildPersistenceService(new ClockService(), metrics);
  return {
    ...built,
    outcomes: (): string[] => recordOrderPersistence.mock.calls.flat(),
    collectQueue: (): Promise<Record<string, number>> => registerQueueCollector.mock.calls[0][0](),
  };
}
