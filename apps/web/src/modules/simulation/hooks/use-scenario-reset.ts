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

  const apply = useCallback(
    async (preset: ScenarioPreset): Promise<void> => {
      setState({ status: 'applying', scenarioId: preset.id });
      const result = await resetFlashSale(preset.payload);
      if (!result.ok) {
        setState({ status: 'failed', scenarioId: preset.id, error: result.error });
        return;
      }
      onApplied(result.data);
      setState({ status: 'applied', scenarioId: preset.id });
    },
    [onApplied],
  );

  return { state, apply };
}
