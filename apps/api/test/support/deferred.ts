export interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

export function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
