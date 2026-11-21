import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import {
  EXPECTED_STATUSES,
  HEALTH_PATH,
  METRIC_NAMES,
  metricForStatus,
  PURCHASE_PATH,
  RESET_PATH,
} from './scenarios.mjs';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EXPECTED_RESPONSES = http.expectedStatuses(...EXPECTED_STATUSES);
const counters = Object.fromEntries(METRIC_NAMES.map((name) => [name, new Counter(name)]));
const connectionWarmup = new Trend('connection_warmup', true);

// Every VU runs its own copy of this module, so this flag is per VU.
let isConnectionWarm = false;

/**
 * Node >= 20 accepts one pending connection per event-loop iteration. When 250 VUs connect at once
 * against a busy loop, the last ones wait 0.3 to 3 s in the accept queue. That wait lands here,
 * reported as connection_warmup, instead of in the purchase latency the budgets judge.
 */
function warmConnection() {
  if (isConnectionWarm) return;
  const res = http.get(`${BASE_URL}${HEALTH_PATH}`, { tags: { endpoint: 'warmup' } });
  connectionWarmup.add(res.timings.duration);
  isConnectionWarm = true;
}

function latencyBudgets(scenario) {
  const budgets = [];
  if (scenario.p95BudgetMs !== null) budgets.push(`p(95)<${scenario.p95BudgetMs}`);
  if (scenario.p99BudgetMs !== null) budgets.push(`p(99)<${scenario.p99BudgetMs}`);
  return budgets;
}

function thresholdsFor(scenario) {
  const thresholds = {};
  for (const name of METRIC_NAMES) {
    thresholds[name] = [`count==${scenario.expected[name] ?? 0}`];
  }
  const budgets = latencyBudgets(scenario);
  if (budgets.length > 0) thresholds['http_req_duration{endpoint:purchase}'] = budgets;
  return thresholds;
}

function recordStatus(status) {
  const matched = metricForStatus(status);
  for (const name of METRIC_NAMES) counters[name].add(name === matched ? 1 : 0);
}

export function purchaseScenario(scenario) {
  const options = {
    scenarios: {
      [scenario.name]: {
        executor: 'shared-iterations',
        vus: scenario.concurrency,
        iterations: scenario.requests,
        maxDuration: '5m',
      },
    },
    thresholds: thresholdsFor(scenario),
    summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  };

  function setup() {
    const res = http.post(
      `${BASE_URL}${RESET_PATH}`,
      JSON.stringify({ totalStock: scenario.totalStock }),
      { headers: JSON_HEADERS },
    );
    const ok = check(res, {
      'reset returned 200': (r) => r.status === 200,
      'reset restored full stock': (r) => r.json('remainingStock') === scenario.totalStock,
    });
    if (!ok) throw new Error(`reset failed: ${res.status} ${res.body}`);
  }

  function run() {
    if (scenario.shouldWarmConnections) warmConnection();
    const userId = scenario.userIdFor(exec.scenario.iterationInTest);
    const res = http.post(`${BASE_URL}${PURCHASE_PATH}`, JSON.stringify({ userId }), {
      headers: JSON_HEADERS,
      tags: { endpoint: 'purchase' },
      responseCallback: EXPECTED_RESPONSES,
    });
    recordStatus(res.status);
  }

  return { options, setup, run };
}
