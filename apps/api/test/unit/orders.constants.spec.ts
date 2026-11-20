import {
  ORDER_COMPENSATION_ATTEMPTS,
  ORDER_COMPENSATION_BACKOFF_MS,
  ORDER_COMPENSATION_JOB_NAME,
  ORDER_COMPENSATION_JOB_OPTIONS,
  ORDER_PERSISTENCE_ATTEMPTS,
  ORDER_PERSISTENCE_BACKOFF_MS,
  ORDER_PERSISTENCE_CONCURRENCY,
  ORDER_PERSISTENCE_JOB_OPTIONS,
  orderCompensationJobId,
  RESET_ACTIVE_JOBS_POLL_MS,
  RESET_ACTIVE_JOBS_TIMEOUT_MS,
} from '../../src/modules/orders/constants/orders.constants';
import { userIdOf } from '../support/user-id.fixtures';

describe('order persistence constants', () => {
  it('runs 20 workers concurrently', () => {
    expect(ORDER_PERSISTENCE_CONCURRENCY).toBe(20);
  });

  it('makes 5 attempts per job', () => {
    expect(ORDER_PERSISTENCE_ATTEMPTS).toBe(5);
  });

  it('backs off from 300 ms', () => {
    expect(ORDER_PERSISTENCE_BACKOFF_MS).toBe(300);
  });

  it('retries with exponential backoff and drops completed jobs', () => {
    expect(ORDER_PERSISTENCE_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 300 },
      removeOnComplete: true,
    });
  });
});

describe('order compensation constants', () => {
  it('names the compensation job compensate-order', () => {
    expect(ORDER_COMPENSATION_JOB_NAME).toBe('compensate-order');
  });

  it('makes 8 attempts backing off exponentially from 1000 ms and drops completed jobs', () => {
    expect(ORDER_COMPENSATION_ATTEMPTS).toBe(8);
    expect(ORDER_COMPENSATION_BACKOFF_MS).toBe(1000);
    expect(ORDER_COMPENSATION_JOB_OPTIONS).toEqual({
      attempts: 8,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
  });

  it('derives a colon-free job id from the orderId', () => {
    const ref = { saleId: 'sale-1', userId: userIdOf('alice'), orderId: 'order-1' };

    expect(orderCompensationJobId(ref)).toBe('compensate-order-1');
  });
});

describe('admin reset fence constants', () => {
  it('polls active jobs every 25 ms for at most 10 s', () => {
    expect(RESET_ACTIVE_JOBS_POLL_MS).toBe(25);
    expect(RESET_ACTIVE_JOBS_TIMEOUT_MS).toBe(10_000);
  });
});
