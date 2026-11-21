import { useMemo, useState } from 'react';
import { type PollTask, usePolling } from '@/shared/hooks/use-polling';
import { fetchOrderStatus } from '../api/orders.api';
import { CONFIRMATION_POLL_INTERVAL_MS } from '../constants/orders.constants';
import type { ConfirmationState } from '../types/orders.types';
import { nextConfirmation } from '../utils/confirmation-transition.util';

interface WatchSession {
  userId: string;
}

interface Reported {
  session: WatchSession;
  confirmation: ConfirmationState;
}

const IDLE: ConfirmationState = { phase: 'idle' };
const POLLING: ConfirmationState = { phase: 'polling' };

function buildTask(
  session: WatchSession,
  report: (confirmation: ConfirmationState) => void,
): PollTask {
  let attemptsMade = 0;
  return async (signal) => {
    const result = await fetchOrderStatus(session.userId, signal);
    if (signal.aborted) return 'continue';
    attemptsMade += 1;
    const { next, verdict } = nextConfirmation(result.ok ? result.data : null, attemptsMade);
    report(next);
    return verdict;
  };
}

export function useOrderConfirmationPoller(userId: string | null): ConfirmationState {
  const [reported, setReported] = useState<Reported | null>(null);
  const session = useMemo<WatchSession | null>(
    () => (userId === null ? null : { userId }),
    [userId],
  );
  const task = useMemo<PollTask | null>(
    () =>
      session === null
        ? null
        : buildTask(session, (confirmation) => setReported({ session, confirmation })),
    [session],
  );

  usePolling(task, CONFIRMATION_POLL_INTERVAL_MS);

  if (session === null) return IDLE;
  return reported?.session === session ? reported.confirmation : POLLING;
}
