import { useEffect, useMemo, useState } from 'react';
import { COUNTDOWN_TICK_MS } from '../constants/flash-sale.constants';
import type { ServerCountdownParams } from '../types/flash-sale.types';

export function useServerCountdown({ targetAt, serverTime }: ServerCountdownParams): number {
  const [, setTick] = useState(0);
  const clockOffsetMs = useMemo(() => Date.parse(serverTime) - Date.now(), [serverTime]);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return Math.max(0, Date.parse(targetAt) - (Date.now() + clockOffsetMs));
}
