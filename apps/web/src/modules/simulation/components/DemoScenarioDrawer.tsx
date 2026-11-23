import { type ReactElement, useId, useState } from 'react';
import type { FlashSaleStatus } from '@/modules/flash-sale';
import { DRAWER_TOGGLE_LABEL } from '../constants/simulation.constants';
import { useScenarioReset } from '../hooks/use-scenario-reset';
import { ScenarioDrawerPanel } from './ScenarioDrawerPanel';

interface DemoScenarioDrawerProps {
  onScenarioApplied: (sale: FlashSaleStatus) => void;
}

export function DemoScenarioDrawer({ onScenarioApplied }: DemoScenarioDrawerProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const panelId = useId();
  const { state, requiresAdminKey, apply } = useScenarioReset(onScenarioApplied);

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
          <ScenarioDrawerPanel
            panelId={panelId}
            state={state}
            adminKey={adminKey}
            showAdminKey={requiresAdminKey || adminKey !== ''}
            onAdminKeyChange={setAdminKey}
            onSelect={(selected) => void apply(selected, adminKey)}
          />
        ) : null}
      </div>
    </aside>
  );
}
