import type { ReactElement } from 'react';
import { Alert } from '@/shared/components/Alert';
import type { Tone } from '@/shared/types/tone.types';
import {
  RESET_ERROR_TITLES,
  type ResetErrorCode,
  SCENARIO_PRESETS,
} from '../constants/simulation.constants';
import type { ScenarioResetState } from '../types/simulation.types';

interface ScenarioResetNoticeProps {
  state: ScenarioResetState;
}

interface FailurePresentation {
  tone: Tone;
  title: string;
}

function labelOf(state: Exclude<ScenarioResetState, { status: 'idle' }>): string {
  return SCENARIO_PRESETS.find((preset) => preset.id === state.scenarioId)?.label ?? '';
}

function isResetErrorCode(code: string): code is ResetErrorCode {
  return Object.hasOwn(RESET_ERROR_TITLES, code);
}

function failurePresentation(
  state: Extract<ScenarioResetState, { status: 'failed' }>,
): FailurePresentation {
  if (isResetErrorCode(state.error.code)) {
    return RESET_ERROR_TITLES[state.error.code];
  }
  return { tone: 'danger', title: `Could not apply ${labelOf(state)}` };
}

export function ScenarioResetNotice({ state }: ScenarioResetNoticeProps): ReactElement | null {
  if (state.status === 'idle') return null;
  if (state.status === 'failed') {
    const { tone, title } = failurePresentation(state);
    return (
      <Alert tone={tone} title={title}>
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
