import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PollTask, type PollVerdict, usePolling } from '../hooks/use-polling';

const INTERVAL_MS = 1000;

function advance(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function delayedTask(durationMs: number, verdict: PollVerdict = 'continue'): PollTask {
  return vi.fn(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    return verdict;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePolling', () => {
  it('runs the task immediately on mount', async () => {
    const task: PollTask = vi.fn(async () => 'continue' as const);

    renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(0);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs again one interval after the previous run settles, not before', async () => {
    const task: PollTask = vi.fn(async () => 'continue' as const);
    renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(0);

    await advance(INTERVAL_MS - 1);
    expect(task).toHaveBeenCalledTimes(1);
    await advance(1);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a slow task and counts the interval from when it settles', async () => {
    const task = delayedTask(1500);
    renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(0);

    await advance(INTERVAL_MS);
    expect(task).toHaveBeenCalledTimes(1);
    await advance(500 + INTERVAL_MS - 1);
    expect(task).toHaveBeenCalledTimes(1);
    await advance(1);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('stops without scheduling another run when the task returns stop', async () => {
    const task: PollTask = vi.fn(async () => 'stop' as const);

    renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(0);

    expect(vi.getTimerCount()).toBe(0);
    await advance(INTERVAL_MS * 5);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('keeps polling until the task returns stop', async () => {
    const verdicts: PollVerdict[] = ['continue', 'stop'];
    const task: PollTask = vi.fn(async () => verdicts.shift() ?? 'stop');

    renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(INTERVAL_MS * 5);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('never runs the task while it is null', async () => {
    renderHook(() => usePolling(null, INTERVAL_MS));

    await advance(INTERVAL_MS * 3);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the in-flight signal and stops polling on unmount', async () => {
    const signals: AbortSignal[] = [];
    const task: PollTask = vi.fn(async (signal: AbortSignal): Promise<PollVerdict> => {
      signals.push(signal);
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      return 'continue';
    });
    const { unmount } = renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(100);

    unmount();
    await advance(INTERVAL_MS * 5);

    expect(signals[0]?.aborted).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the pending timer on unmount', async () => {
    const task: PollTask = vi.fn(async () => 'continue' as const);
    const { unmount } = renderHook(() => usePolling(task, INTERVAL_MS));
    await advance(0);

    unmount();
    await advance(INTERVAL_MS * 3);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('restarts immediately and aborts the old run when the task identity changes', async () => {
    const signals: AbortSignal[] = [];
    const first: PollTask = vi.fn(async (signal: AbortSignal): Promise<PollVerdict> => {
      signals.push(signal);
      return 'continue';
    });
    const second: PollTask = vi.fn(async () => 'continue' as const);
    const { rerender } = renderHook(({ task }) => usePolling(task, INTERVAL_MS), {
      initialProps: { task: first },
    });
    await advance(0);

    rerender({ task: second });
    await advance(0);

    expect(signals[0]?.aborted).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    await advance(INTERVAL_MS * 2);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('restarts with the new interval when intervalMs changes', async () => {
    const task: PollTask = vi.fn(async () => 'continue' as const);
    const { rerender } = renderHook(({ ms }) => usePolling(task, ms), {
      initialProps: { ms: INTERVAL_MS },
    });
    await advance(0);

    rerender({ ms: 200 });
    await advance(0);
    await advance(200);

    expect(task).toHaveBeenCalledTimes(3);
  });
});
