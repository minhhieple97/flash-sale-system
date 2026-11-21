import type { ReactElement } from 'react';
import { Alert } from '@/shared/components/Alert';
import { SCENARIO_PRESETS } from '../constants/simulation.constants';
import type { ScenarioResetState } from '../types/simulation.types';

interface ScenarioResetNoticeProps {
  state: ScenarioResetState;
}

function labelOf(state: Exclude<ScenarioResetState, { status: 'idle' }>): string {
  return SCENARIO_PRESETS.find((preset) => preset.id === state.scenarioId)?.label ?? '';
}

export function ScenarioResetNotice({ state }: ScenarioResetNoticeProps): ReactElement | null {
  if (state.status === 'idle') return null;
  if (state.status === 'failed') {
    return (
      <Alert tone="danger" title={`Could not apply ${labelOf(state)}`}>
        {state.error.message}
      </Alert>
    );
  }
  const text = state.status === 'applying' ? 'Applying' : 'Live scenario';
  return (
    <p role="status" className="text-sm text-slate-600">
      {text}: <span className="font-semibold text-slate-900">{labelOf(state)}</span>
    </p>
  );
}
