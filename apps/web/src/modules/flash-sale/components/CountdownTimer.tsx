import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { COUNTDOWN_TICK_MS } from '../constants/flash-sale.constants';
import type { ServerCountdownParams } from '../types/flash-sale.types';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function useServerCountdown({ targetAt, serverTime }: ServerCountdownParams): number {
  const [, setTick] = useState(0);
  const clockOffsetMs = useMemo(() => Date.parse(serverTime) - Date.now(), [serverTime]);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return Math.max(0, Date.parse(targetAt) - (Date.now() + clockOffsetMs));
}

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
