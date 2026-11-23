import type { ApiError } from '@/shared/types/api.types';

export type ScenarioId = 'active' | 'high-scarcity' | 'upcoming' | 'ended';

export interface ResetFlashSalePayload {
  totalStock?: number;
  startsOffsetSeconds?: number;
  durationSeconds?: number;
}

export interface ScenarioPreset {
  id: ScenarioId;
  label: string;
  description: string;
  payload: ResetFlashSalePayload;
}

export type ScenarioResetState =
  | { status: 'idle' }
  | { status: 'applying'; scenarioId: ScenarioId }
  | { status: 'applied'; scenarioId: ScenarioId }
  | { status: 'failed'; scenarioId: ScenarioId; error: ApiError };

export interface ScenarioResetHandle {
  state: ScenarioResetState;
  requiresAdminKey: boolean;
  apply: (preset: ScenarioPreset, adminKey?: string) => Promise<void>;
}
