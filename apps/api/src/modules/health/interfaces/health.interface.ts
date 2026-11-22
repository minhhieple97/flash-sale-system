export type DependencyState = 'up' | 'down';
export type HealthStatus = 'ok' | 'error';

export interface HealthReport {
  status: HealthStatus;
  checks: { database: DependencyState; redis: DependencyState };
}
