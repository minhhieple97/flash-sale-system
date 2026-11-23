import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

import {
  CURRENT_FLASH_SALE_PATH,
  EXPECTED_STATUSES,
  FEATURED_PRODUCT_PATH,
  HEALTH_PATH,
  METRIC_NAMES,
  metricForStatus,
  ORDER_LOOKUP_PATH,
  PURCHASE_PATH,
  RESET_PATH,
  resetBody,
  SCENARIOS,
} from './scenarios.mjs';
import { barrierVerdict, isMidRun, rateOver } from './stress-math.mjs';

const SCENARIO = SCENARIOS.realisticMix;
const BASE_URL = __ENV.BASE_URL || 'http://web:80';
const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || '';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EXPECTED_RESPONSES = http.expectedStatuses(...EXPECTED_STATUSES);
const EXPECTED_READ_RESPONSES = http.expectedStatuses(200);
const BARRIER_WAIT_MS = 5000;
const READER_WINDOW_S = 8;
const VALID_BUYER_STATUSES = new Set(['NONE', 'RESERVED', 'CONFIRMED']);

const counters = Object.fromEntries(METRIC_NAMES.map((name) => [name, new Counter(name)]));
const barrierVus = new Counter('barrier_vus');
const readFailures = new Counter('read_failures');
const connectionWarmup = new Trend('connection_warmup', true);
const midRunRequests = new Counter('mid_run_requests');
const midRunBusyMs = new Counter('mid_run_busy_ms');
const midRunDoneAt = new Trend('mid_run_done_at');

let isConnectionWarm = false;

export const options = {
  scenarios: {
    buyers: {
      executor: 'shared-iterations',
      vus: SCENARIO.concurrency,
      iterations: SCENARIO.requests,
      maxDuration: '5m',
      exec: 'runBuyer',
    },
    storefront_readers: {
      executor: 'constant-vus',
      vus: 50,
      duration: '13s',
      startTime: '0s',
      exec: 'runReader',
    },
    order_lookups: {
      executor: 'constant-vus',
      vus: 30,
      duration: '13s',
      startTime: '0s',
      exec: 'runLookup',
    },
  },
  thresholds: {
    reserved_202: [`count==${SCENARIO.expected.reserved_202}`],
    sold_out_410: [`count==${SCENARIO.expected.sold_out_410}`],
    conflict_409: ['count==0'],
    unexpected_5xx: ['count==0'],
    barrier_vus: [`count>=${barrierVerdict(0, SCENARIO.concurrency).minimum}`],
    read_failures: ['count==0'],
    'http_req_duration{endpoint:purchase}': [
      `p(95)<${SCENARIO.p95BudgetMs}`,
      `p(99)<${SCENARIO.p99BudgetMs}`,
    ],
    'http_req_duration{endpoint:read}': ['p(99)<450'],
    'http_req_duration{endpoint:lookup}': ['p(99)<600'],
    'http_reqs{endpoint:read}': ['count>0'],
    'http_reqs{endpoint:lookup}': ['count>0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const headers = ADMIN_API_KEY ? { ...JSON_HEADERS, 'x-admin-key': ADMIN_API_KEY } : JSON_HEADERS;
  const res = http.post(`${BASE_URL}${RESET_PATH}`, JSON.stringify(resetBody(SCENARIO)), {
    headers,
  });
  const ok = check(res, {
    'reset returned 200': (r) => r.status === 200,
    'reset restored full stock': (r) => r.json('remainingStock') === SCENARIO.totalStock,
  });
  if (!ok) throw new Error(`reset failed: ${res.status} ${res.body}`);
}

function warmConnection(shouldCountBarrier) {
  if (isConnectionWarm) return;
  const barrierAt = exec.scenario.startTime + BARRIER_WAIT_MS;
  const res = http.get(`${BASE_URL}${HEALTH_PATH}`, {
    tags: { endpoint: 'warmup' },
    responseCallback: EXPECTED_READ_RESPONSES,
  });
  connectionWarmup.add(res.timings.duration);
  isConnectionWarm = true;
  if (Date.now() > barrierAt) return;
  if (shouldCountBarrier) barrierVus.add(1);
  sleep((barrierAt - Date.now()) / 1000);
}

function recordStatus(status) {
  const matched = metricForStatus(status);
  for (const name of METRIC_NAMES) counters[name].add(name === matched ? 1 : 0);
}

function recordMidRun(startedAt, index) {
  if (!isMidRun(index, SCENARIO.requests)) return;
  const doneAt = Date.now();
  midRunRequests.add(1);
  midRunBusyMs.add(doneAt - startedAt);
  midRunDoneAt.add(doneAt);
}

export function runBuyer() {
  warmConnection(true);
  const index = exec.scenario.iterationInTest;
  const startedAt = Date.now();
  const res = http.post(
    `${BASE_URL}${PURCHASE_PATH}`,
    JSON.stringify({ userId: SCENARIO.userIdFor(index) }),
    { headers: JSON_HEADERS, tags: { endpoint: 'purchase' }, responseCallback: EXPECTED_RESPONSES },
  );
  recordStatus(res.status);
  recordMidRun(startedAt, index);
}

export function runReader() {
  warmConnection(false);
  const path =
    exec.scenario.iterationInTest % 2 === 0 ? FEATURED_PRODUCT_PATH : CURRENT_FLASH_SALE_PATH;
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { endpoint: 'read' },
    responseCallback: EXPECTED_READ_RESPONSES,
  });
  const ok = check(res, { 'read status is 200': (r) => r.status === 200 });
  readFailures.add(ok ? 0 : 1);
}

export function runLookup() {
  warmConnection(false);
  const iter = exec.scenario.iterationInTest;
  const isBuyerLookup = iter % 2 === 0;
  const userId = isBuyerLookup
    ? SCENARIO.userIdFor(Math.floor(iter / 2) % SCENARIO.totalStock)
    : `non-buyer-${exec.vu.idInTest}-${iter}`;
  const res = http.get(`${BASE_URL}${ORDER_LOOKUP_PATH}/${userId}`, {
    tags: { endpoint: 'lookup' },
    responseCallback: EXPECTED_READ_RESPONSES,
  });
  const ok = check(res, {
    'lookup status is 200': (r) => r.status === 200,
    'lookup order status is expected': (r) => {
      if (r.status !== 200) return false;
      try {
        const status = r.json('status');
        return isBuyerLookup ? VALID_BUYER_STATUSES.has(status) : status === 'NONE';
      } catch {
        return false;
      }
    },
  });
  readFailures.add(ok ? 0 : 1);
}

function fmtLatency(metric) {
  const f = (key) => (metric?.[key] === undefined ? 'n/a' : metric[key].toFixed(1));
  return `p50=${f('med')} p95=${f('p(95)')} p99=${f('p(99)')} max=${f('max')}`;
}

function buyerRows(m) {
  const done = m('mid_run_done_at');
  const rps = rateOver(m('mid_run_requests').count, done.min, done.max);
  const busy = m('mid_run_busy_ms').count / (done.max - done.min);
  const counts = METRIC_NAMES.map((k) => m(k).count ?? 0).join('/');
  return [
    ['barrier VUs reached', `${m('barrier_vus').count ?? 0}/${SCENARIO.concurrency}`],
    ['buyers mid-run window', `${((done.max - done.min) / 1000).toFixed(2)}s`],
    ['buyers mid-run throughput', `${rps.toFixed(1)} req/s`],
    ['buyers avg in-flight VUs', `${busy.toFixed(1)}/${SCENARIO.concurrency}`],
    ['buyers (202/409/410/5xx)', counts],
    ['purchase latency (ms)', fmtLatency(m('http_req_duration{endpoint:purchase}'))],
  ];
}

function readRows(m) {
  const reads = m('http_reqs{endpoint:read}').count ?? 0;
  const lookups = m('http_reqs{endpoint:lookup}').count ?? 0;
  const fails = m('read_failures').count ?? 0;
  const failed = ((m('http_req_failed').rate ?? 0) * 100).toFixed(2);
  return [
    ['read reqs (8s) / fail', `${reads} (${(reads / READER_WINDOW_S).toFixed(1)}/s) / ${fails}`],
    ['read latency (ms)', fmtLatency(m('http_req_duration{endpoint:read}'))],
    ['lookup reqs (8s)', `${lookups} (${(lookups / READER_WINDOW_S).toFixed(1)}/s)`],
    ['lookup latency (ms)', fmtLatency(m('http_req_duration{endpoint:lookup}'))],
    ['http_req_failed rate', `${failed}%`],
  ];
}

export function handleSummary(data) {
  const m = (name) => data.metrics[name]?.values ?? {};
  const lines = [...buyerRows(m), ...readRows(m)].map(([l, v]) => `${l.padEnd(30)}${v}\n`).join('');
  const checksOut = Object.entries(data.metrics)
    .flatMap(([name, metric]) =>
      Object.entries(metric.thresholds ?? {}).map(
        ([rule, outcome]) => `${outcome.ok ? 'PASS' : 'FAIL'} ${name} ${rule}\n`,
      ),
    )
    .join('');
  return { stdout: `\n== ${SCENARIO.name} (k6 via ${BASE_URL}) ==\n${lines}${checksOut}` };
}
