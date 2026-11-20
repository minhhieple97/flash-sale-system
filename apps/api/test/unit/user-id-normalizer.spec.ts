import { normalizeUserId } from '../../src/common/utils/user-id-normalizer.util';

describe('normalizeUserId', () => {
  it('trims and lowercases a valid id', () => {
    const result = normalizeUserId('  Alice@Example.COM ');

    expect(result).toEqual({ isValid: true, userId: 'alice@example.com' });
  });

  it('accepts every allowed punctuation character', () => {
    const result = normalizeUserId('a.b_c-d+e@f.io');

    expect(result).toEqual({ isValid: true, userId: 'a.b_c-d+e@f.io' });
  });

  it.each([
    ['exactly 3 characters', 'abc'],
    ['exactly 128 characters after trimming', ` ${'a'.repeat(128)} `],
  ])('accepts %s', (_name, raw) => {
    const result = normalizeUserId(raw);

    expect(result.isValid).toBe(true);
  });

  it.each([
    ['2 characters after trimming', '  ab '],
    ['129 characters', 'a'.repeat(129)],
    ['an inner space', 'al ice'],
    ['an exclamation mark', 'alice!'],
    ['a hash', 'ali#ce'],
    ['a non-ascii letter', 'alüce'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
  ])('rejects %s with INVALID_USER_ID', (_name, raw) => {
    const result = normalizeUserId(raw);

    expect(result.isValid).toBe(false);
    if (result.isValid) return;
    expect(result.error.code).toBe('INVALID_USER_ID');
    expect(result.error.message).toEqual(expect.any(String));
  });
});
