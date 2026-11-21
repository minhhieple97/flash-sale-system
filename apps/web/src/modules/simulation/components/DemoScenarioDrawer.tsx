import { type ReactElement, useId, useState } from 'react';
import type { FlashSaleStatus } from '@/modules/flash-sale';
import { DRAWER_TOGGLE_LABEL, SCENARIO_PRESETS } from '../constants/simulation.constants';
import { useScenarioReset } from '../hooks/use-scenario-reset';
import { ScenarioPresetButton } from './ScenarioPresetButton';
import { ScenarioResetNotice } from './ScenarioResetNotice';

interface DemoScenarioDrawerProps {
  onScenarioApplied: (sale: FlashSaleStatus) => void;
}

export function DemoScenarioDrawer({ onScenarioApplied }: DemoScenarioDrawerProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const { state, apply } = useScenarioReset(onScenarioApplied);
  const isApplying = state.status === 'applying';
  const liveId = state.status === 'applied' ? state.scenarioId : null;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center justify-between py-3 text-sm font-semibold text-slate-700"
        >
          {DRAWER_TOGGLE_LABEL}
          <span aria-hidden="true">{isOpen ? '▾' : '▴'}</span>
        </button>
        {isOpen ? (
          <div id={panelId} className="space-y-3 pb-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SCENARIO_PRESETS.map((preset) => (
                <ScenarioPresetButton
                  key={preset.id}
                  preset={preset}
                  isLive={preset.id === liveId}
                  isDisabled={isApplying}
                  onSelect={(selected) => void apply(selected)}
                />
              ))}
            </div>
            <ScenarioResetNotice state={state} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
