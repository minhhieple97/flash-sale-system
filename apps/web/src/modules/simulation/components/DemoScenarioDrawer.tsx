import { type ReactElement, useId, useState } from 'react';
import type { FlashSaleStatus } from '@/modules/flash-sale';
import { Alert } from '@/shared/components/Alert';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import {
  DRAWER_TOGGLE_LABEL,
  RESET_ERROR_TITLES,
  type ResetErrorCode,
  SCENARIO_PRESETS,
} from '../constants/simulation.constants';
import { useScenarioReset } from '../hooks/use-scenario-reset';
import type { ScenarioPreset, ScenarioResetState } from '../types/simulation.types';

const PRESET_BASE = 'rounded-xl border px-4 py-3 transition';
const PRESET_LIVE = 'border-indigo-400 bg-indigo-50';
const PRESET_REST = 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50';

function ScenarioPresetButton({
  preset,
  isLive,
  isDisabled,
  isApplying,
  onSelect,
}: {
  preset: ScenarioPreset;
  isLive: boolean;
  isDisabled: boolean;
  isApplying: boolean;
  onSelect: (preset: ScenarioPreset) => void;
}): ReactElement {
  const descriptionId = useId();
  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={isApplying}
      aria-label={preset.label}
      aria-describedby={descriptionId}
      onClick={() => onSelect(preset)}
      className={`${PRESET_BASE} ${isLive ? PRESET_LIVE : PRESET_REST} w-full text-left disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        {isApplying ? <LoadingSpinner /> : null}
        {preset.label}
      </span>
      <span id={descriptionId} className="mt-0.5 block text-xs text-slate-500">
        {preset.description}
      </span>
    </button>
  );
}

function ScenarioResetNotice({ state }: { state: ScenarioResetState }): ReactElement | null {
  if (state.status === 'idle') return null;
  const label = SCENARIO_PRESETS.find((preset) => preset.id === state.scenarioId)?.label ?? '';
  if (state.status === 'failed') {
    const presentation = Object.hasOwn(RESET_ERROR_TITLES, state.error.code)
      ? RESET_ERROR_TITLES[state.error.code as ResetErrorCode]
      : { tone: 'danger' as const, title: `Could not apply ${label}` };
    return (
      <Alert tone={presentation.tone} title={presentation.title}>
        {state.error.message}
      </Alert>
    );
  }
  const text = state.status === 'applying' ? 'Applying' : 'Live scenario';
  return (
    <p role="status" className="text-sm text-slate-600">
      {text}: <span className="font-semibold text-slate-900">{label}</span>
    </p>
  );
}

export function DemoScenarioDrawer({
  onScenarioApplied,
}: {
  onScenarioApplied: (sale: FlashSaleStatus) => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const panelId = useId();
  const keyInputId = useId();
  const { state, requiresAdminKey, apply } = useScenarioReset(onScenarioApplied);
  const isApplying = state.status === 'applying';

  return (
    <aside className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-15px_rgba(15,23,42,0.18)] backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center justify-between py-4 text-sm font-semibold text-slate-700 transition hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          {DRAWER_TOGGLE_LABEL}
          <span aria-hidden="true">{isOpen ? '▾' : '▴'}</span>
        </button>
        {isOpen ? (
          <div id={panelId} className="max-h-[60vh] space-y-3 overflow-y-auto pb-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SCENARIO_PRESETS.map((preset) => (
                <ScenarioPresetButton
                  key={preset.id}
                  preset={preset}
                  isLive={state.status === 'applied' && preset.id === state.scenarioId}
                  isDisabled={isApplying}
                  isApplying={isApplying && state.scenarioId === preset.id}
                  onSelect={(selected) => void apply(selected, adminKey)}
                />
              ))}
            </div>
            {requiresAdminKey || adminKey !== '' ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <label htmlFor={keyInputId} className="text-xs font-medium text-slate-700">
                  Admin key
                </label>
                <input
                  id={keyInputId}
                  type="password"
                  value={adminKey}
                  disabled={isApplying}
                  onChange={(event) => setAdminKey(event.target.value)}
                  autoComplete="off"
                  placeholder="Enter ADMIN_API_KEY"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-xs"
                />
              </div>
            ) : null}
            <ScenarioResetNotice state={state} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
