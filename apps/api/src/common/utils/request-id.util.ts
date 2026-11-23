export function formatRequestTag(requestId?: string): string {
  return requestId ? `[req=${requestId}] ` : '';
}
