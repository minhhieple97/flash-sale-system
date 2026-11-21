import { useCallback, useState } from 'react';
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

export function useFlashSaleStatus(): FlashSaleStatusHandle {
  const [feed, setFeed] = useState<FlashSaleFeed>(INITIAL_FEED);

  const applySnapshot = useCallback((sale: FlashSaleStatus): void => {
    setFeed((current) => (isOlderThan(sale, current.sale) ? current : { sale, error: null }));
  }, []);

  const recordFailure = useCallback((error: ApiError): void => {
    setFeed((current) => ({ ...current, error }));
  }, []);

  const poll = useCallback<PollTask>(
    async (signal) => {
      const result = await fetchCurrentFlashSale(signal);
      if (signal.aborted) return 'continue';
      if (result.ok) applySnapshot(result.data);
      else recordFailure(result.error);
      return 'continue';
    },
    [applySnapshot, recordFailure],
  );

  usePolling(poll, STATUS_POLL_INTERVAL_MS);

  return { ...feed, applySnapshot };
}
