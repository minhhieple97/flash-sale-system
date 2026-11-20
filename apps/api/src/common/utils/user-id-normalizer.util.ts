import {
  ERROR_CODES,
  INVALID_USER_ID_MESSAGE,
  USER_ID_MAX_LENGTH,
  USER_ID_MIN_LENGTH,
  USER_ID_PATTERN,
} from '../constants/common.constants';
import type { NormalizedUserId, UserIdNormalization } from '../interfaces/user-id.interface';

const INVALID_USER_ID: UserIdNormalization = {
  isValid: false,
  error: { code: ERROR_CODES.INVALID_USER_ID, message: INVALID_USER_ID_MESSAGE },
};

export function normalizeUserId(raw: unknown): UserIdNormalization {
  if (typeof raw !== 'string') return INVALID_USER_ID;
  const candidate = raw.trim().toLowerCase();
  const isLengthValid =
    candidate.length >= USER_ID_MIN_LENGTH && candidate.length <= USER_ID_MAX_LENGTH;
  if (!isLengthValid || !USER_ID_PATTERN.test(candidate)) return INVALID_USER_ID;
  return { isValid: true, userId: candidate as NormalizedUserId };
}
