import { describe, expect, it } from 'vitest';
import { USER_ID_FORMAT_HINT, validateUserId } from '../utils/user-id-validation.util';

describe('validateUserId', () => {
  it('exposes the expected format hint copy', () => {
    expect(USER_ID_FORMAT_HINT).toBe('3–128 characters: a–z, 0–9, . _ @ + -');
  });

  it('returns empty for an empty or whitespace-only string', () => {
    expect(validateUserId('')).toBe('empty');
    expect(validateUserId('   \t ')).toBe('empty');
  });

  it('returns valid for trimmed/lowercased ids within 3..128 allowed characters', () => {
    expect(validateUserId('abc')).toBe('valid');
    expect(validateUserId('a'.repeat(128))).toBe('valid');
    expect(validateUserId('  Alice._@+-9  ')).toBe('valid');
  });

  it('returns invalid when trimmed length is under 3 or over 128', () => {
    expect(validateUserId('ab')).toBe('invalid');
    expect(validateUserId('  ab  ')).toBe('invalid');
    expect(validateUserId('a'.repeat(129))).toBe('invalid');
  });

  it('returns invalid when characters outside a-z 0-9 . _ @ + - appear', () => {
    expect(validateUserId('alice smith')).toBe('invalid');
    expect(validateUserId('alice!')).toBe('invalid');
    expect(validateUserId('user/1')).toBe('invalid');
  });
});
