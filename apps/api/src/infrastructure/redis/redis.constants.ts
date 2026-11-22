export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_CLOSED_STATUS = 'end';
export const REDIS_READY_EVENT = 'ready';
export const REDIS_COMMAND_TIMEOUT_MS = 2_000;
export const REDIS_FAIL_FAST_MAX_RETRIES = 1;
/** ioredis's default reconnect cadence. BullMQ's default would keep its producer down for 1 s or more. */
export const REDIS_RECONNECT_STEP_MS = 50;
export const REDIS_RECONNECT_MAX_DELAY_MS = 2_000;
export const REDIS_UNAVAILABLE_ERROR_NAMES: readonly string[] = [
  'AbortError',
  'MaxRetriesPerRequestError',
];
/** ioredis rejects these with a plain Error, so only the message tells them apart. */
export const REDIS_UNAVAILABLE_MESSAGES: readonly string[] = [
  "Stream isn't writeable",
  'Connection is closed',
  'Command timed out',
];
export const REDIS_UNAVAILABLE_SOCKET_CODES: readonly string[] = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
];
