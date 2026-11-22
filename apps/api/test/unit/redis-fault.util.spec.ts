import { isRedisUnavailable } from '../../src/infrastructure/redis/redis-fault.util';

function named(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('isRedisUnavailable', () => {
  it.each([
    ['an aborted command', named('AbortError', 'Command aborted due to connection close')],
    ['exhausted retries', named('MaxRetriesPerRequestError', 'Reached the max retries')],
    [
      'an offline client',
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
    ],
    ['a closed connection', new Error('Connection is closed.')],
    ['a command timeout', new Error('Command timed out')],
    [
      'a refused socket',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ],
  ])('recognises %s', (_label, error) => {
    expect(isRedisUnavailable(error)).toBe(true);
  });

  it.each([
    ['a programming error', new TypeError('x is not a function')],
    ['a corrupt field', new Error('Corrupt flash sale field totalStock: abc')],
    ['a non-error value', 'Connection is closed.'],
  ])('rejects %s', (_label, error) => {
    expect(isRedisUnavailable(error)).toBe(false);
  });
});
