import { useCallback, useEffect, useRef, useState } from 'react';
import { type PollTask, usePolling } from '@/shared/hooks/use-polling';
import type { ApiError } from '@/shared/types/api.types';
import { fetchCurrentFlashSale } from '../api/flash-sale.api';
import { STATUS_POLL_INTERVAL_MS } from '../constants/flash-sale.constants';
import type {
  FlashSaleFeed,
  FlashSaleStatus,
  FlashSaleStatusHandle,
} from '../types/flash-sale.types';

const INITIAL_FEED: FlashSaleFeed = { sale: null, error: null };

function isOlderThan(candidate: FlashSaleStatus, current: FlashSaleStatus | null): boolean {
  return current !== null && Date.parse(candidate.serverTime) < Date.parse(current.serverTime);
}

interface SyncFlashSaleParams {
  signal: AbortSignal;
  isActive: () => boolean;
  onSuccess: (sale: FlashSaleStatus) => void;
  onFailure: (error: ApiError) => void;
}

async function syncFlashSale(params: SyncFlashSaleParams): Promise<void> {
  const result = await fetchCurrentFlashSale(params.signal);
  if (params.signal.aborted || !params.isActive()) return;
  if (result.ok) params.onSuccess(result.data);
  else params.onFailure(result.error);
}

function useRefreshSignal(): { isMounted: () => boolean; nextSignal: () => AbortSignal | null } {
  const isMountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const isMounted = useCallback((): boolean => isMountedRef.current, []);
  const nextSignal = useCallback((): AbortSignal | null => {
    if (!isMountedRef.current) return null;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller.signal;
  }, []);

  return { isMounted, nextSignal };
}

export function useFlashSaleStatus(): FlashSaleStatusHandle {
  const [feed, setFeed] = useState<FlashSaleFeed>(INITIAL_FEED);
  const { isMounted, nextSignal } = useRefreshSignal();

  const applySnapshot = useCallback((sale: FlashSaleStatus): void => {
    setFeed((current) => (isOlderThan(sale, current.sale) ? current : { sale, error: null }));
  }, []);

  const recordFailure = useCallback((error: ApiError): void => {
    setFeed((current) => ({ ...current, error }));
  }, []);

  const poll = useCallback<PollTask>(
    async (signal) => {
      await syncFlashSale({
        signal,
        isActive: () => true,
        onSuccess: applySnapshot,
        onFailure: recordFailure,
      });
      return 'continue';
    },
    [applySnapshot, recordFailure],
  );

  const refresh = useCallback((): void => {
    const signal = nextSignal();
    if (signal === null) return;
    void syncFlashSale({
      signal,
      isActive: isMounted,
      onSuccess: applySnapshot,
      onFailure: recordFailure,
    });
  }, [applySnapshot, isMounted, nextSignal, recordFailure]);

  usePolling(poll, STATUS_POLL_INTERVAL_MS);

  return { ...feed, applySnapshot, refresh };
}
