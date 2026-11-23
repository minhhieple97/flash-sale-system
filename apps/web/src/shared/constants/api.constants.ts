export const API_BASE_PATH = '/api/v1';
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
export const INVALID_RESPONSE_ERROR_CODE = 'INVALID_RESPONSE';
export const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection.';
export const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Please try again.';
export const JSON_CONTENT_TYPE = 'application/json';

export function httpStatusErrorCode(status: number): string {
  return `HTTP_${status}`;
}
