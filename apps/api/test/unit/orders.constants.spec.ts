import {
  ORDER_PERSISTENCE_ATTEMPTS,
  ORDER_PERSISTENCE_BACKOFF_MS,
  ORDER_PERSISTENCE_CONCURRENCY,
  ORDER_PERSISTENCE_JOB_OPTIONS,
} from '../../src/modules/orders/constants/orders.constants';

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
