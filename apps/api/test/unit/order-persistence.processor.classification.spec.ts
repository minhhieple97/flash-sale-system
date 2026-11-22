import { OrderPersistenceRejectedError } from '../../src/modules/orders/errors/order-persistence-rejected.error';
import { buildProcessor, jobOf, PROCESSOR_REF } from '../support/order-processor.mocks';

type Verdict = 'retry' | 'final';

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const PERSIST_ERRORS: readonly [string, Verdict, Error][] = [
  ['ECONNREFUSED', 'retry', pgError('connect ECONNREFUSED', 'ECONNREFUSED')],
  [
    '57014 statement timeout',
    'retry',
    pgError('canceling statement due to statement timeout', '57014'),
  ],
  ['23514 check violation', 'retry', pgError('violates check constraint', '23514')],
  [
    'STOCK_INVARIANT_VIOLATION',
    'final',
    new OrderPersistenceRejectedError('STOCK_INVARIANT_VIOLATION', PROCESSOR_REF.orderId),
  ],
  [
    'SALE_NOT_FOUND',
    'final',
    new OrderPersistenceRejectedError('SALE_NOT_FOUND', PROCESSOR_REF.orderId),
  ],
];

describe('OrderPersistenceProcessor failure classification', () => {
  it.each(PERSIST_ERRORS)('classifies %s as %s', async (_label, verdict, persistError) => {
    const { processor, persistReservedOrder, scheduleCompensation } = buildProcessor();
    persistReservedOrder.mockRejectedValue(persistError);
    const job = jobOf({ attemptsMade: 1, attempts: 150 });
    const thrown: Error = await processor.process(job).then(
      () => new Error('process resolved'),
      (error: Error) => error,
    );

    await processor.onFailed(job, thrown);

    expect(scheduleCompensation).toHaveBeenCalledTimes(verdict === 'final' ? 1 : 0);
  });
});
