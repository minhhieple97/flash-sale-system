import { check, sleep } from 'k6';
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
  resetBody,
} from './scenarios.mjs';
import { barrierVerdict, isMidRun, mergeThresholds, rateOver } from './stress-math.mjs';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || '';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EXPECTED_RESPONSES = http.expectedStatuses(...EXPECTED_STATUSES);
const counters = Object.fromEntries(METRIC_NAMES.map((name) => [name, new Counter(name)]));
const connectionWarmup = new Trend('connection_warmup', true);
const barrierVus = new Counter('barrier_vus');
const midRunRequests = new Counter('mid_run_requests');
const midRunBusyMs = new Counter('mid_run_busy_ms');
const midRunDoneAt = new Trend('mid_run_done_at');

const BARRIER_WAIT_MS = 5000;

// Every VU runs its own copy of this module, so this flag is per VU.
let isConnectionWarm = false;

/**
 * Node >= 20 accepts one pending connection per event-loop iteration. When 250 VUs connect at once
 * against a busy loop, the last ones wait 0.3 to 3 s in the accept queue. That wait lands here,
 * reported as connection_warmup, instead of in the purchase latency the budgets judge.
 */
function warmConnection() {
  if (isConnectionWarm) return;
  const barrierAt = exec.scenario.startTime + BARRIER_WAIT_MS;
  const res = http.get(`${BASE_URL}${HEALTH_PATH}`, { tags: { endpoint: 'warmup' } });
  connectionWarmup.add(res.timings.duration);
  isConnectionWarm = true;
  if (Date.now() > barrierAt) return;
  barrierVus.add(1);
  sleep((barrierAt - Date.now()) / 1000);
}

// k6 only records a submetric that a threshold names, and the summary line reads it.
const NON_GATING_RULE = 'max>=0';

function latencyBudgets(scenario) {
  const budgets = [];
  if (scenario.p95BudgetMs !== null) budgets.push(`p(95)<${scenario.p95BudgetMs}`);
  if (scenario.p99BudgetMs !== null) budgets.push(`p(99)<${scenario.p99BudgetMs}`);
  return budgets;
}

function thresholdsFor(scenario) {
  const counts = {};
  for (const name of METRIC_NAMES) counts[name] = [`count==${scenario.expected[name] ?? 0}`];
  const budgets = latencyBudgets(scenario);
  const extra = {
    'http_req_duration{endpoint:purchase}': budgets.length > 0 ? budgets : [NON_GATING_RULE],
  };
  if (scenario.p99Reserved202BudgetMs !== null) {
    extra['http_req_duration{status:202}'] = [`p(99)<${scenario.p99Reserved202BudgetMs}`];
  }
  if (scenario.shouldWarmConnections) {
    extra.barrier_vus = [`count>=${barrierVerdict(0, scenario.concurrency).minimum}`];
  }
  return mergeThresholds(counts, extra);
}

function recordMidRun(scenario, startedAt, index) {
  if (!isMidRun(index, scenario.requests)) return;
  const doneAt = Date.now();
  midRunRequests.add(1);
  midRunBusyMs.add(doneAt - startedAt);
  midRunDoneAt.add(doneAt);
}

function summaryLine(label, value) {
  return `${label.padEnd(34)}${value}\n`;
}

function reportSummary(scenario, data) {
  const m = (name) => data.metrics[name]?.values ?? {};
  const done = m('mid_run_done_at');
  const windowMs = done.max - done.min;
  const throughput = rateOver(m('mid_run_requests').count, done.min, done.max);
  const inFlight = m('mid_run_busy_ms').count / windowMs;
  const p202 = m('http_req_duration{status:202}');
  let text = `\n== ${scenario.name} (k6) ==\n`;
  if (scenario.shouldWarmConnections) {
    text += summaryLine(
      'barrier VUs reached',
      `${m('barrier_vus').count ?? 0}/${scenario.concurrency}`,
    );
  }
  text += summaryLine('mid-run throughput (middle 80%)', `${throughput.toFixed(1)} req/s`);
  text += summaryLine(
    'mid-run in-flight (avg busy VUs)',
    `${inFlight.toFixed(1)}/${scenario.concurrency}`,
  );
  text += summaryLine(
    'purchase latency p95/p99 ms',
    `${m('http_req_duration{endpoint:purchase}')['p(95)']?.toFixed(1)}/${m('http_req_duration{endpoint:purchase}')['p(99)']?.toFixed(1)}`,
  );
  text += summaryLine('202 latency p99 ms', `${p202['p(99)']?.toFixed(1) ?? 'n/a'}`);
  for (const [name, metric] of Object.entries(data.metrics)) {
    for (const [rule, outcome] of Object.entries(metric.thresholds ?? {})) {
      text += `${outcome.ok ? 'PASS' : 'FAIL'} ${name} ${rule}\n`;
    }
  }
  return text;
}

function recordStatus(status) {
  const matched = metricForStatus(status);
  for (const name of METRIC_NAMES) counters[name].add(name === matched ? 1 : 0);
}

function optionsFor(scenario) {
  return {
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
}

function resetHeaders() {
  return ADMIN_API_KEY ? { ...JSON_HEADERS, 'x-admin-key': ADMIN_API_KEY } : JSON_HEADERS;
}

function resetStock(scenario) {
  const res = http.post(`${BASE_URL}${RESET_PATH}`, JSON.stringify(resetBody(scenario)), {
    headers: resetHeaders(),
  });
  const ok = check(res, {
    'reset returned 200': (r) => r.status === 200,
    'reset restored full stock': (r) => r.json('remainingStock') === scenario.totalStock,
  });
  if (!ok) throw new Error(`reset failed: ${res.status} ${res.body}`);
}

function attemptPurchase(scenario) {
  if (scenario.shouldWarmConnections) warmConnection();
  const index = exec.scenario.iterationInTest;
  const userId = scenario.userIdFor(index);
  const startedAt = Date.now();
  const res = http.post(`${BASE_URL}${PURCHASE_PATH}`, JSON.stringify({ userId }), {
    headers: JSON_HEADERS,
    tags: { endpoint: 'purchase' },
    responseCallback: EXPECTED_RESPONSES,
  });
  recordStatus(res.status);
  recordMidRun(scenario, startedAt, index);
}

export function purchaseScenario(scenario) {
  return {
    options: optionsFor(scenario),
    setup: () => resetStock(scenario),
    run: () => attemptPurchase(scenario),
    handleSummary: (data) => ({ stdout: reportSummary(scenario, data) }),
  };
}
