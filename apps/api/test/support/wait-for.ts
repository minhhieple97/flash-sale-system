const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 25;

export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Bounded polling for integration specs that wait on a real BullMQ worker. */
export async function waitFor<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS }: WaitForOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isDone(value)) {
    if (Date.now() > deadline) {
      throw new Error(
        `waitFor timed out after ${timeoutMs} ms, last value: ${JSON.stringify(value)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    value = await read();
  }
  return value;
}
