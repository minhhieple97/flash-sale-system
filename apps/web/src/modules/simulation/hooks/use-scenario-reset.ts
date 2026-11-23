import { useCallback, useState } from 'react';
import type { FlashSaleStatus } from '@/modules/flash-sale';
import { resetFlashSale } from '../api/simulation.api';
import type {
  ScenarioPreset,
  ScenarioResetHandle,
  ScenarioResetState,
} from '../types/simulation.types';

const IDLE: ScenarioResetState = { status: 'idle' };

export function useScenarioReset(onApplied: (sale: FlashSaleStatus) => void): ScenarioResetHandle {
  const [state, setState] = useState<ScenarioResetState>(IDLE);
  const [requiresAdminKey, setRequiresAdminKey] = useState(false);

  const apply = useCallback(
    async (preset: ScenarioPreset, adminKey?: string): Promise<void> => {
      setState({ status: 'applying', scenarioId: preset.id });
      const result = await resetFlashSale(preset.payload, adminKey);
      if (!result.ok) {
        if (result.status === 401) setRequiresAdminKey(true);
        setState({ status: 'failed', scenarioId: preset.id, error: result.error });
        return;
      }
      setRequiresAdminKey(false);
      onApplied(result.data);
      setState({ status: 'applied', scenarioId: preset.id });
    },
    [onApplied],
  );

  return { state, requiresAdminKey, apply };
}
