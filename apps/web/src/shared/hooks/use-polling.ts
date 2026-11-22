import { useEffect } from 'react';

export type PollVerdict = 'continue' | 'stop';
export type PollTask = (signal: AbortSignal) => Promise<PollVerdict>;

export function usePolling(task: PollTask | null, intervalMs: number): void {
  useEffect(() => {
    if (task === null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (): Promise<void> => {
      const verdict = await task(controller.signal);
      if (controller.signal.aborted || verdict === 'stop') return;
      timer = setTimeout(run, intervalMs);
    };
    void run();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [task, intervalMs]);
}
