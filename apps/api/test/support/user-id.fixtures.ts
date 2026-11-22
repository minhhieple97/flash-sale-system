import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { normalizeUserId } from '../../src/common/utils/user-id-normalizer.util';

export function userIdOf(raw: string): NormalizedUserId {
  const normalization = normalizeUserId(raw);
  if (!normalization.isValid) throw new Error(`fixture user id is invalid: ${raw}`);
  return normalization.userId;
}
