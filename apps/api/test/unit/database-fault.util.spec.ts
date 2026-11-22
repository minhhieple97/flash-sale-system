import { isDatabaseUnavailable } from '../../src/infrastructure/database/database-fault.util';

function withCode(code: string, message = 'db fault'): Error {
  return Object.assign(new Error(message), { code });
}

function withDriverError(driverError: unknown, message = 'query failed'): Error {
  return Object.assign(new Error(message), { driverError });
}

describe('isDatabaseUnavailable', () => {
  it.each(['08000', '08003', '08006', '57P01', '57P02', '57P03', '53300'])(
    'recognizes PostgreSQL SQLSTATE %s directly and on driverError',
    (sqlstate) => {
      expect(isDatabaseUnavailable(withCode(sqlstate))).toBe(true);
      expect(isDatabaseUnavailable(withDriverError(withCode(sqlstate)))).toBe(true);
    },
  );

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'])(
    'recognizes socket code %s on error, driverError, and AggregateError',
    (code) => {
      const aggregate = new AggregateError([withCode(code)], 'all addresses failed');
      expect(isDatabaseUnavailable(withCode(code))).toBe(true);
      expect(isDatabaseUnavailable(withDriverError({ code }))).toBe(true);
      expect(isDatabaseUnavailable(withDriverError(aggregate))).toBe(true);
    },
  );

  it.each([
    'Connection terminated unexpectedly',
    'timeout exceeded when trying to connect',
    'canceling statement due to statement timeout',
    'Cannot use a pool after calling end',
  ])('recognizes pool/timeout message "%s" on error and driverError', (fragment) => {
    expect(isDatabaseUnavailable(new Error(`pg: ${fragment}`))).toBe(true);
    expect(isDatabaseUnavailable(withDriverError(new Error(fragment)))).toBe(true);
  });

  it.each([
    ['unique violation', withDriverError(withCode('23505'))],
    ['check violation', withDriverError(withCode('23514'))],
    ['generic error', new TypeError('cannot read property')],
    ['non-error', 'Connection terminated unexpectedly'],
  ])('rejects %s', (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
  });
});
