export const API_GLOBAL_PREFIX = 'api/v1';
export const DEFAULT_HTTP_PORT = 3000;
export const HTTP_LISTEN_HOST = '0.0.0.0';
export const HEALTH_ROUTE = 'health';
export const USER_ID_MIN_LENGTH = 3;
export const USER_ID_MAX_LENGTH = 128;
export const USER_ID_PATTERN = /^[a-z0-9._@+-]+$/;
export const ERROR_CODES = {
  INVALID_USER_ID: 'INVALID_USER_ID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TEMPORARY_FAILURE: 'TEMPORARY_FAILURE',
} as const;
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';
export const TEMPORARY_FAILURE_MESSAGE = 'Temporarily unable to process the request; please retry';
export const INVALID_USER_ID_MESSAGE = `userId must be ${USER_ID_MIN_LENGTH}-${USER_ID_MAX_LENGTH} characters of a-z, 0-9, ".", "_", "@", "+" or "-"`;
export const VALIDATION_MESSAGE_SEPARATOR = '; ';
