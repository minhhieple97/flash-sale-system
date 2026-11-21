export const RESERVED_STATUS = 202;
export const STATUS_METRICS = {
  [RESERVED_STATUS]: 'reserved_202',
  409: 'conflict_409',
  410: 'sold_out_410',
};
export const EXPECTED_STATUSES = Object.keys(STATUS_METRICS).map(Number);
export const UNEXPECTED_5XX = 'unexpected_5xx';
export const METRIC_NAMES = [...Object.values(STATUS_METRICS), UNEXPECTED_5XX];

export const HEALTH_PATH = '/health';
export const RESET_PATH = '/api/v1/admin/flash-sales/reset';
export const PURCHASE_PATH = '/api/v1/checkout/purchase';
export const ORDER_LOOKUP_PATH = '/api/v1/orders/user';

export function metricForStatus(status) {
  if (STATUS_METRICS[status]) return STATUS_METRICS[status];
  return status >= 500 ? UNEXPECTED_5XX : null;
}

const RACER_VARIANTS = [
  'stress-racer@example.com',
  'STRESS-RACER@EXAMPLE.COM',
  '  Stress-Racer@Example.com  ',
  '\t\nStress-RACER@example.COM\n',
];

export const SCENARIOS = {
  oversell: {
    name: 'oversell',
    totalStock: 100,
    requests: 5000,
    concurrency: 250,
    userIdFor: (i) => `stress-buyer-${i}`,
    expected: { reserved_202: 100, sold_out_410: 4900 },
    // Opens every connection before its first purchase, so the latency budgets measure purchases
    // instead of the API's one-accept-per-event-loop-iteration queue (see k6-purchase.mjs).
    shouldWarmConnections: true,
    p95BudgetMs: 250,
    p99BudgetMs: 500,
  },
  sameUserRace: {
    name: 'same-user-race',
    totalStock: 50,
    requests: 300,
    concurrency: 100,
    userIdFor: (i) => RACER_VARIANTS[i % RACER_VARIANTS.length],
    normalizedUserId: 'stress-racer@example.com',
    expected: { reserved_202: 1, conflict_409: 299 },
    // Fires cold on purpose: the race wants all 300 requests to land at once, and it has no budget.
    shouldWarmConnections: false,
    p95BudgetMs: null,
    p99BudgetMs: null,
  },
};
