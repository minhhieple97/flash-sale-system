import {
  ORDER_COMPENSATION_JOB_OPTIONS,
  ORDER_PERSISTENCE_FAILED_JOB_MAX_AGE_SECONDS,
  ORDER_PERSISTENCE_JOB_OPTIONS,
  orderCompensationJobId,
  orderPersistenceJobId,
} from '../../src/modules/orders/constants/orders.constants';
import { userIdOf } from '../support/user-id.fixtures';

const REF = { saleId: 'sale-1', userId: userIdOf('alice'), orderId: 'order-1' };

describe('order job ids', () => {
  it('uses the orderId as the persistence job id, which BullMQ accepts without a colon', () => {
    expect(orderPersistenceJobId(REF)).toBe('order-1');
  });

  it('derives a colon-free compensation job id from the orderId', () => {
    expect(orderCompensationJobId(REF)).toBe('compensate-order-1');
  });

  it('bounds failed job retention on both persistence and compensation options', () => {
    expect(ORDER_PERSISTENCE_JOB_OPTIONS.removeOnFail).toEqual({
      age: ORDER_PERSISTENCE_FAILED_JOB_MAX_AGE_SECONDS,
    });
    expect(ORDER_COMPENSATION_JOB_OPTIONS.removeOnFail).toEqual({
      age: ORDER_PERSISTENCE_FAILED_JOB_MAX_AGE_SECONDS,
    });
  });
});
