import {
  REDIS_UNAVAILABLE_ERROR_NAMES,
  REDIS_UNAVAILABLE_MESSAGES,
  REDIS_UNAVAILABLE_SOCKET_CODES,
} from './redis.constants';

export function isRedisUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (REDIS_UNAVAILABLE_ERROR_NAMES.includes(error.name)) return true;
  const { code } = error as { code?: unknown };
  if (typeof code === 'string' && REDIS_UNAVAILABLE_SOCKET_CODES.includes(code)) return true;
  return REDIS_UNAVAILABLE_MESSAGES.some((fragment) => error.message.includes(fragment));
}
