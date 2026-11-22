export async function settleWithin(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('STILL_PENDING'), ms);
  });
  const settled = promise.then(
    () => 'RESOLVED',
    (error: unknown) => error,
  );
  try {
    return await Promise.race([settled, pending]);
  } finally {
    clearTimeout(timer);
  }
}
