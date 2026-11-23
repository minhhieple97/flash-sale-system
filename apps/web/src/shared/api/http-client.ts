import type { ApiError, HttpResult } from '../types/common.types';

export const API_BASE_PATH = '/api/v1';
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
export const INVALID_RESPONSE_ERROR_CODE = 'INVALID_RESPONSE';
export const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection.';
export const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Please try again.';
export const JSON_CONTENT_TYPE = 'application/json';

export function httpStatusErrorCode(status: number): string {
  return `HTTP_${status}`;
}

export interface HttpRequest {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function buildHeaders(
  hasBody: boolean,
  customHeaders?: Readonly<Record<string, string>>,
): HeadersInit | undefined {
  if (!hasBody && !customHeaders) return undefined;
  return {
    ...customHeaders,
    ...(hasBody ? { 'Content-Type': JSON_CONTENT_TYPE } : undefined),
  };
}

async function toResult<T>(response: Response): Promise<HttpResult<T>> {
  const body = await readJson(response);
  if (response.ok) {
    if (body === undefined) {
      return {
        ok: false,
        status: response.status,
        error: { code: INVALID_RESPONSE_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE },
      };
    }
    return { ok: true, status: response.status, data: body as T };
  }
  const error = isApiError(body)
    ? { code: body.code, message: body.message }
    : { code: httpStatusErrorCode(response.status), message: FALLBACK_ERROR_MESSAGE };
  return { ok: false, status: response.status, error };
}

export async function requestJson<T>(request: HttpRequest): Promise<HttpResult<T>> {
  const { path, method = 'GET', body, headers, signal } = request;
  const hasBody = body !== undefined;
  try {
    const response = await fetch(API_BASE_PATH + path, {
      method,
      headers: buildHeaders(hasBody, headers),
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    });
    return await toResult<T>(response);
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: NETWORK_ERROR_CODE, message: NETWORK_ERROR_MESSAGE },
    };
  }
}
