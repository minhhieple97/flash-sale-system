import { DATABASE_UNAVAILABLE_CODES, DATABASE_UNAVAILABLE_MESSAGES } from './database.constants';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function matchesFault(candidate: unknown): boolean {
  if (!isRecord(candidate)) return false;
  const { code, message } = candidate;
  if (typeof code === 'string' && DATABASE_UNAVAILABLE_CODES.has(code)) return true;
  return (
    typeof message === 'string' &&
    DATABASE_UNAVAILABLE_MESSAGES.some((fragment) => message.includes(fragment))
  );
}

function nestedErrors(candidate: unknown): unknown[] {
  if (!isRecord(candidate)) return [];
  const nested: unknown[] = [];
  if ('driverError' in candidate) nested.push(candidate.driverError);
  if (Array.isArray(candidate.errors)) nested.push(...candidate.errors);
  return nested;
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (matchesFault(error)) return true;
  return nestedErrors(error).some(
    (nested) => matchesFault(nested) || nestedErrors(nested).some(matchesFault),
  );
}
