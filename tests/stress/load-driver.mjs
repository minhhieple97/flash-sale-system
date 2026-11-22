import { monitorEventLoopDelay } from 'node:perf_hooks';
import { orderStatus, postJson, request } from './http-client.mjs';
import {
  HEALTH_PATH,
  metricForStatus,
  PURCHASE_PATH,
  RESERVED_STATUS,
  RESET_PATH,
  resetBody,
} from './scenarios.mjs';
import { CONFIRMED_STATUS } from './store-keys.mjs';

const POLL_INTERVAL_MS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NETWORK_ERROR = 'network_error';
export const OTHER_STATUS = 'other_status';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function resetSale(scenario) {
  const { status, body } = await postJson(RESET_PATH, resetBody(scenario));
  const ok = status === 200 && body?.remainingStock === scenario.totalStock;
  if (!ok || !UUID_RE.test(body.saleId)) {
    throw new Error(`reset failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.saleId;
}

function recordOutcome(result, response, userId) {
  const bucket = metricForStatus(response.status) ?? OTHER_STATUS;
  result.counts[bucket] = (result.counts[bucket] ?? 0) + 1;
  if (response.status === RESERVED_STATUS) {
    result.reserved.push({ orderId: response.body?.orderId, userId });
  }
}

async function sendOne(result, userId) {
  const startedAt = performance.now();
  try {
    const response = await postJson(PURCHASE_PATH, { userId });
    const finishedAt = performance.now();
    result.latenciesMs.push(finishedAt - startedAt);
    result.completionsMs.push(finishedAt);
    recordOutcome(result, response, userId);
  } catch {
    result.counts[NETWORK_ERROR] = (result.counts[NETWORK_ERROR] ?? 0) + 1;
  }
}

/**
 * Opens one keep-alive socket per worker before the timed burst, so the server's one-accept-per-
 * event-loop-iteration wait stays out of the purchase latency (see k6-purchase.mjs).
 */
async function warmConnections(count) {
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: count }, () => request('GET', HEALTH_PATH)));
  return performance.now() - startedAt;
}

export async function fire(scenario) {
  const result = { counts: {}, latenciesMs: [], completionsMs: [], reserved: [], wallMs: 0 };
  if (scenario.shouldWarmConnections) {
    result.warmupMs = await warmConnections(scenario.concurrency);
  }
  let next = 0;
  const worker = async () => {
    while (next < scenario.requests) {
      const index = next++;
      await sendOne(result, scenario.userIdFor(index));
    }
  };
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: scenario.concurrency }, worker));
  result.wallMs = performance.now() - startedAt;
  loopDelay.disable();
  result.clientLoopDelayP99Ms = loopDelay.percentile(99) / 1e6;
  result.reservedOrderIds = result.reserved.map((entry) => entry.orderId);
  return result;
}

export async function drain(reserved, horizonMs) {
  const deadline = Date.now() + horizonMs;
  let pending = reserved;
  while (pending.length > 0 && Date.now() < deadline) {
    const statuses = await Promise.all(pending.map((entry) => orderStatus(entry.userId)));
    pending = pending.filter((_, i) => statuses[i] !== CONFIRMED_STATUS);
    if (pending.length > 0) await sleep(POLL_INTERVAL_MS);
  }
  return pending.length;
}
