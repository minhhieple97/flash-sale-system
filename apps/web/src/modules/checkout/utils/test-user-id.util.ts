import { TEST_USER_ID_PREFIX, TEST_USER_ID_SUFFIX_LENGTH } from '../constants/checkout.constants';

export function generateTestUserId(): string {
  const hex = crypto.randomUUID().replaceAll('-', '');
  return TEST_USER_ID_PREFIX + hex.slice(0, TEST_USER_ID_SUFFIX_LENGTH);
}
