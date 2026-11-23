import { useCallback, useState } from 'react';
import type { FlashSaleStatus } from '@/modules/flash-sale';
import { requestJson } from '@/shared/api/http-client';
import { ADMIN_KEY_HEADER, RESET_FLASH_SALE_PATH } from '../constants/simulation.constants';
import type {
  ScenarioPreset,
  ScenarioResetHandle,
  ScenarioResetState,
} from '../types/simulation.types';

export function useScenarioReset(onApplied: (sale: FlashSaleStatus) => void): ScenarioResetHandle {
  const [state, setState] = useState<ScenarioResetState>({ status: 'idle' });
  const [requiresAdminKey, setRequiresAdminKey] = useState(false);

  const apply = useCallback(
    async (preset: ScenarioPreset, adminKey?: string): Promise<void> => {
      setState({ status: 'applying', scenarioId: preset.id });
      const trimmedKey = adminKey?.trim();
      const result = await requestJson<FlashSaleStatus>({
        path: RESET_FLASH_SALE_PATH,
        method: 'POST',
        body: preset.payload,
        headers: trimmedKey ? { [ADMIN_KEY_HEADER]: trimmedKey } : undefined,
      });
      if (result.ok) {
        setState({ status: 'applied', scenarioId: preset.id });
        onApplied(result.data);
        return;
      }
      if (result.status === 401) setRequiresAdminKey(true);
      setState({ status: 'failed', scenarioId: preset.id, error: result.error });
    },
    [onApplied],
  );

  return { state, requiresAdminKey, apply };
}
