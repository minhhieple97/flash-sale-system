export interface ApiError {
  code: string;
  message: string;
}

export type HttpResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError };
