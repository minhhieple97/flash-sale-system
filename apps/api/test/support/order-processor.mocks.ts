import type { Job } from 'bullmq';
import { ORDER_PERSISTENCE_JOB_NAME } from '../../src/modules/orders/constants/orders.constants';
import type {
  CompensationOutcome,
  PersistOrderResult,
} from '../../src/modules/orders/interfaces/order.interface';
import { OrderPersistenceProcessor } from '../../src/modules/orders/processors/order-persistence.processor';
import type { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { userIdOf } from './user-id.fixtures';

export const PROCESSOR_REF: ReservationRef = {
  saleId: 'sale-1',
  userId: userIdOf('alice'),
  orderId: 'order-1',
};

export interface JobShape {
  name?: string;
  attemptsMade?: number;
  attempts?: number;
}

export function jobOf({
  name = ORDER_PERSISTENCE_JOB_NAME,
  attemptsMade = 0,
  attempts,
}: JobShape = {}): Job<ReservationRef> {
  return {
    name,
    data: PROCESSOR_REF,
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<ReservationRef>;
}

export interface ProcessorMocks {
  processor: OrderPersistenceProcessor;
  persistReservedOrder: jest.Mock<Promise<PersistOrderResult>, [ReservationRef]>;
  compensateFailedOrder: jest.Mock<Promise<CompensationOutcome>, [ReservationRef]>;
  scheduleCompensation: jest.Mock<Promise<void>, [ReservationRef]>;
}

export function buildProcessor(): ProcessorMocks {
  const persistReservedOrder = jest.fn<Promise<PersistOrderResult>, [ReservationRef]>();
  const compensateFailedOrder = jest.fn<Promise<CompensationOutcome>, [ReservationRef]>();
  const scheduleCompensation = jest.fn<Promise<void>, [ReservationRef]>(async () => undefined);
  const processor = new OrderPersistenceProcessor({
    persistReservedOrder,
    compensateFailedOrder,
    scheduleCompensation,
  } as unknown as OrderPersistenceService);
  return { processor, persistReservedOrder, compensateFailedOrder, scheduleCompensation };
}
