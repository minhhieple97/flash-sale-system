import {
  API_BASE_PATH,
  FALLBACK_ERROR_MESSAGE,
  httpStatusErrorCode,
  JSON_CONTENT_TYPE,
  NETWORK_ERROR_CODE,
  NETWORK_ERROR_MESSAGE,
} from '../constants/api.constants';
import type { ApiError, HttpResult } from '../types/api.types';

export interface HttpRequest {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
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

async function toResult<T>(response: Response): Promise<HttpResult<T>> {
  const body = await readJson(response);
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const error = isApiError(body)
    ? { code: body.code, message: body.message }
    : { code: httpStatusErrorCode(response.status), message: FALLBACK_ERROR_MESSAGE };
  return { ok: false, status: response.status, error };
}

export async function requestJson<T>(request: HttpRequest): Promise<HttpResult<T>> {
  const { path, method = 'GET', body, signal } = request;
  const hasBody = body !== undefined;
  try {
    const response = await fetch(API_BASE_PATH + path, {
      method,
      headers: hasBody ? { 'Content-Type': JSON_CONTENT_TYPE } : undefined,
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
