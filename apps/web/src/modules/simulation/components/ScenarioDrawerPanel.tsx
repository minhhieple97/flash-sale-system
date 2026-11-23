import type { ReactElement } from 'react';
import { SCENARIO_PRESETS } from '../constants/simulation.constants';
import type { ScenarioPreset, ScenarioResetState } from '../types/simulation.types';
import { AdminKeyField } from './AdminKeyField';
import { ScenarioPresetButton } from './ScenarioPresetButton';
import { ScenarioResetNotice } from './ScenarioResetNotice';

interface ScenarioDrawerPanelProps {
  panelId: string;
  state: ScenarioResetState;
  adminKey: string;
  showAdminKey: boolean;
  onAdminKeyChange: (value: string) => void;
  onSelect: (preset: ScenarioPreset) => void;
}

export function ScenarioDrawerPanel({
  panelId,
  state,
  adminKey,
  showAdminKey,
  onAdminKeyChange,
  onSelect,
}: ScenarioDrawerPanelProps): ReactElement {
  const isApplying = state.status === 'applying';
  return (
    <div id={panelId} className="max-h-[60vh] space-y-3 overflow-y-auto pb-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SCENARIO_PRESETS.map((preset) => (
          <ScenarioPresetButton
            key={preset.id}
            preset={preset}
            isLive={state.status === 'applied' && preset.id === state.scenarioId}
            isDisabled={isApplying}
            isApplying={isApplying && state.scenarioId === preset.id}
            onSelect={onSelect}
          />
        ))}
      </div>
      {showAdminKey ? (
        <AdminKeyField value={adminKey} disabled={isApplying} onChange={onAdminKeyChange} />
      ) : null}
      <ScenarioResetNotice state={state} />
    </div>
  );
}
