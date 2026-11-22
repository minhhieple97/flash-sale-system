import type { ApiError } from './api-error.interface';

declare const normalizedUserIdBrand: unique symbol;

/**
 * A user id that went through `normalizeUserId` (trimmed, lowercased, validated).
 * A raw `string` is not assignable, so un-normalized input cannot reach a service or repository.
 * The brand key is a module-private unique symbol, so it cannot be forged with an object literal.
 * Casting to it is reserved for `normalizeUserId` and for repository row mappers that read ids
 * this system wrote.
 */
export type NormalizedUserId = string & { readonly [normalizedUserIdBrand]: true };

export type UserIdNormalization =
  | { isValid: true; userId: NormalizedUserId }
  | { isValid: false; error: ApiError };
