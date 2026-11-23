import { useEffect, useMemo, useState } from 'react';
import type { FlashSaleStatus, SaleState } from '../types/flash-sale.types';

const MAX_TIMEOUT_MS = 2_147_483_647;

function advanceState(sale: FlashSaleStatus, serverNowMs: number): SaleState {
  if (serverNowMs < Date.parse(sale.startsAt)) return 'UPCOMING';
  if (serverNowMs > Date.parse(sale.endsAt)) return 'ENDED';
  return sale.remainingStock <= 0 ? 'SOLD_OUT' : 'ACTIVE';
}

function nextBoundaryMs(sale: FlashSaleStatus, serverNowMs: number): number | null {
  const startsAtMs = Date.parse(sale.startsAt);
  if (Number.isFinite(startsAtMs) && serverNowMs < startsAtMs) return startsAtMs;
  const endsAtMs = Date.parse(sale.endsAt);
  if (Number.isFinite(endsAtMs) && serverNowMs <= endsAtMs) return endsAtMs + 1;
  return null;
}

function scheduleBoundaryTransition(
  sale: FlashSaleStatus,
  clockOffsetMs: number,
  onBoundary: () => void,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    const serverNowMs = Date.now() + clockOffsetMs;
    const targetMs = nextBoundaryMs(sale, serverNowMs);
    if (targetMs === null) return;
    timer = setTimeout(
      () => {
        if (!active) return;
        if (Date.now() + clockOffsetMs >= targetMs) onBoundary();
        arm();
      },
      Math.min(targetMs - serverNowMs, MAX_TIMEOUT_MS),
    );
  };
  arm();
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

export function useEffectiveSaleState(sale: FlashSaleStatus | null): SaleState | null {
  const [, setTick] = useState(0);
  const serverTime = sale?.serverTime;
  const clockOffsetMs = useMemo(
    () => (serverTime === undefined ? 0 : Date.parse(serverTime) - Date.now()),
    [serverTime],
  );

  useEffect(() => {
    if (sale === null) return;
    return scheduleBoundaryTransition(sale, clockOffsetMs, () => setTick((tick) => tick + 1));
  }, [sale, clockOffsetMs]);

  return sale === null ? null : advanceState(sale, Date.now() + clockOffsetMs);
}
