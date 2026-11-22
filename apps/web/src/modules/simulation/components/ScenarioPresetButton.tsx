import { type ReactElement, useId } from 'react';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { ScenarioPreset } from '../types/simulation.types';

interface ScenarioPresetButtonProps {
  preset: ScenarioPreset;
  isLive: boolean;
  isDisabled: boolean;
  isApplying: boolean;
  onSelect: (preset: ScenarioPreset) => void;
}

const BASE = 'rounded-xl border px-4 py-3 transition';
const LIVE = 'border-indigo-400 bg-indigo-50';
const REST = 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50';

export function ScenarioPresetButton({
  preset,
  isLive,
  isDisabled,
  isApplying,
  onSelect,
}: ScenarioPresetButtonProps): ReactElement {
  const descriptionId = useId();
  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={isApplying}
      aria-label={preset.label}
      aria-describedby={descriptionId}
      onClick={() => onSelect(preset)}
      className={`${BASE} ${isLive ? LIVE : REST} w-full text-left disabled:cursor-not-allowed disabled:opacity-60`}
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
