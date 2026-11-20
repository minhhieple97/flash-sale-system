import type { ApiError } from './api-error.interface';

export type NormalizedUserId = string & { readonly __brand: 'NormalizedUserId' };

export type UserIdNormalization =
  | { isValid: true; userId: NormalizedUserId }
  | { isValid: false; error: ApiError };
