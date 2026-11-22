import type { Tone } from '@/shared/types/tone.types';
import type { ScenarioPreset } from '../types/simulation.types';

export const RESET_FLASH_SALE_PATH = '/admin/flash-sales/reset';
export const DRAWER_TOGGLE_LABEL = 'Demo scenarios';

export type ResetErrorCode = 'NOT_FOUND' | 'UNAUTHORIZED';

export const RESET_ERROR_TITLES = {
  NOT_FOUND: { tone: 'info', title: 'Demo resets disabled' },
  UNAUTHORIZED: { tone: 'warning', title: 'Admin key required' },
} as const satisfies Record<ResetErrorCode, { tone: Tone; title: string }>;

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'active',
    label: 'Active Sale',
    description: '100 stock, 1h',
    payload: { totalStock: 100, startsOffsetSeconds: 0, durationSeconds: 3600 },
  },
  {
    id: 'high-scarcity',
    label: 'High Scarcity',
    description: '3 stock left',
    payload: { totalStock: 3, startsOffsetSeconds: 0, durationSeconds: 3600 },
  },
  {
    id: 'upcoming',
    label: 'Upcoming Countdown',
    description: 'Starts in 15s',
    payload: { totalStock: 100, startsOffsetSeconds: 15, durationSeconds: 3600 },
  },
  {
    id: 'ended',
    label: 'Ended Sale',
    description: 'Window closed',
    payload: { totalStock: 100, startsOffsetSeconds: -7200, durationSeconds: 3600 },
  },
];
