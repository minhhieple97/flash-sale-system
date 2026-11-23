export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface ApiError {
  code: string;
  message: string;
}

export type HttpResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError };

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError };
