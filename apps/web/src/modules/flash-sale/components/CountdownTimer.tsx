import type { ReactElement } from 'react';
import { useServerCountdown } from '../hooks/use-server-countdown';
import { formatCountdown } from '../utils/format-countdown.util';

interface CountdownTimerProps {
  label: string;
  targetAt: string;
  serverTime: string;
}

export function CountdownTimer({ label, targetAt, serverTime }: CountdownTimerProps): ReactElement {
  const remainingMs = useServerCountdown({ targetAt, serverTime });
  return (
    <p role="timer" className="text-sm text-slate-600">
      {label}{' '}
      <span className="font-mono text-xl font-bold tabular-nums text-slate-900">
        {formatCountdown(remainingMs)}
      </span>
    </p>
  );
}
