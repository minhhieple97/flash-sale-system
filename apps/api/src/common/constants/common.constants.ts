export const API_GLOBAL_PREFIX = 'api/v1';
export const DEFAULT_HTTP_PORT = 3000;
export const HTTP_LISTEN_HOST = '0.0.0.0';
export const HTTP_BODY_LIMIT_BYTES = 16_384;
export const HTTP_MAX_PARAM_LENGTH = 400;
export const MAX_SALE_TOTAL_STOCK = 1_000_000;
export const HEALTH_ROUTE = 'health';
export const METRICS_ROUTE = 'metrics';
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
export const RATE_LIMIT_MAX_BUCKETS = 50_000;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX = 60;
export const USER_ID_MIN_LENGTH = 3;
export const USER_ID_MAX_LENGTH = 128;
export const USER_ID_PATTERN = /^[a-z0-9._@+-]+$/;
export const ERROR_CODES = {
  INVALID_USER_ID: 'INVALID_USER_ID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TEMPORARY_FAILURE: 'TEMPORARY_FAILURE',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';
export const TEMPORARY_FAILURE_MESSAGE = 'Temporarily unable to process the request; please retry';
export const RATE_LIMITED_MESSAGE = 'Too many requests; please retry shortly';
export const UNAUTHORIZED_ADMIN_MESSAGE = 'Invalid or missing admin API key';
export const INVALID_USER_ID_MESSAGE = `userId must be ${USER_ID_MIN_LENGTH}-${USER_ID_MAX_LENGTH} characters of a-z, 0-9, ".", "_", "@", "+" or "-"`;
export const VALIDATION_MESSAGE_SEPARATOR = '; ';
