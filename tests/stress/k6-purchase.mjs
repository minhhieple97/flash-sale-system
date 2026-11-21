import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import {
  EXPECTED_STATUSES,
  METRIC_NAMES,
  metricForStatus,
  PURCHASE_PATH,
  RESET_PATH,
} from './scenarios.mjs';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EXPECTED_RESPONSES = http.expectedStatuses(...EXPECTED_STATUSES);
const counters = Object.fromEntries(METRIC_NAMES.map((name) => [name, new Counter(name)]));

function thresholdsFor(scenario) {
  const thresholds = {};
  for (const name of METRIC_NAMES) {
    thresholds[name] = [`count==${scenario.expected[name] ?? 0}`];
  }
  if (scenario.p95BudgetMs !== null) {
    thresholds['http_req_duration{endpoint:purchase}'] = [`p(95)<${scenario.p95BudgetMs}`];
  }
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
