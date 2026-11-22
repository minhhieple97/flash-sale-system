export type UserIdValidity = 'empty' | 'valid' | 'invalid';

export const USER_ID_MIN_LENGTH = 3;
export const USER_ID_MAX_LENGTH = 128;
export const USER_ID_PATTERN = /^[a-z0-9._@+-]+$/;
export const USER_ID_FORMAT_HINT = '3–128 characters: a–z, 0–9, . _ @ + -';

export function validateUserId(value: string): UserIdValidity {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return 'empty';
  const hasValidLength =
    normalized.length >= USER_ID_MIN_LENGTH && normalized.length <= USER_ID_MAX_LENGTH;
  return hasValidLength && USER_ID_PATTERN.test(normalized) ? 'valid' : 'invalid';
}
