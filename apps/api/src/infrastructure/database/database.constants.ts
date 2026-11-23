export const SCHEMA_ADVISORY_LOCK_KEY = 726_011_001;
export const API_DATABASE_POOL_MAX = 5;
export const DATABASE_POOL_MAX = 20;
export const DATABASE_CONNECTION_TIMEOUT_MS = 2_000;
export const DATABASE_STATEMENT_TIMEOUT_MS = 5_000;

export const DATABASE_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  '08000',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export const DATABASE_UNAVAILABLE_MESSAGES: readonly string[] = [
  'Connection terminated unexpectedly',
  'timeout exceeded when trying to connect',
  'canceling statement due to statement timeout',
  'Cannot use a pool after calling end',
];
