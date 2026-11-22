import { useEffect, useMemo, useState } from 'react';
import { COUNTDOWN_TICK_MS } from '../constants/flash-sale.constants';
import type { FlashSaleStatus, SaleState } from '../types/flash-sale.types';

function advanceState(sale: FlashSaleStatus, serverNowMs: number): SaleState {
  if (sale.saleState === 'UPCOMING' && serverNowMs >= Date.parse(sale.startsAt)) {
    return serverNowMs > Date.parse(sale.endsAt) ? 'ENDED' : 'ACTIVE';
  }
  if (sale.saleState === 'ACTIVE' && serverNowMs > Date.parse(sale.endsAt)) return 'ENDED';
  return sale.saleState;
}

export function useEffectiveSaleState(sale: FlashSaleStatus | null): SaleState | null {
  const [, setTick] = useState(0);
  const serverTime = sale?.serverTime;
  const clockOffsetMs = useMemo(
    () => (serverTime === undefined ? 0 : Date.parse(serverTime) - Date.now()),
    [serverTime],
  );
  const isTimeDriven = sale?.saleState === 'UPCOMING' || sale?.saleState === 'ACTIVE';

  useEffect(() => {
    if (!isTimeDriven) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [isTimeDriven]);

  return sale === null ? null : advanceState(sale, Date.now() + clockOffsetMs);
}
