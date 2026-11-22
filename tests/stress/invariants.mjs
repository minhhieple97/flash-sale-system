import { NETWORK_ERROR, OTHER_STATUS } from './load-driver.mjs';
import { METRIC_NAMES } from './scenarios.mjs';
import { CONFIRMED_PREFIX } from './store-keys.mjs';

function sameMembers(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const isUnique = left.size === a.length && right.size === b.length;
  return isUnique && left.size === right.size && b.every((x) => left.has(x));
}

export function responseChecks(scenario, result) {
  const checks = METRIC_NAMES.map((name) => {
    const want = scenario.expected[name] ?? 0;
    const got = result.counts[name] ?? 0;
    return { label: `${name} count`, ok: got === want, detail: `got ${got}, want ${want}` };
  });
  const stray = result.counts[OTHER_STATUS] ?? 0;
  const netErrors = result.counts[NETWORK_ERROR] ?? 0;
  checks.push({ label: 'no other statuses', ok: stray === 0, detail: `${stray} responses` });
  checks.push({ label: 'no network errors', ok: netErrors === 0, detail: `${netErrors} errors` });
  return checks;
}

function postgresChecks({ scenario, result, snap }) {
  const orderCount = snap.orderIds.length;
  return [
    {
      label: 'PG order ids equal 202 order ids',
      ok: sameMembers(snap.orderIds, result.reservedOrderIds),
      detail: `pg ${orderCount}, 202s ${result.reservedOrderIds.length}`,
    },
    {
      label: 'PG remaining_stock equals total_stock minus orders',
      ok: snap.remainingStock === snap.totalStock - orderCount,
      detail: `remaining ${snap.remainingStock}, total ${snap.totalStock}, orders ${orderCount}`,
    },
    {
      label: 'PG total_stock matches scenario',
      ok: snap.totalStock === scenario.totalStock,
      detail: `got ${snap.totalStock}`,
    },
  ];
}

function redisChecks({ scenario, snap }) {
  const reserved = scenario.expected.reserved_202 ?? 0;
  const confirmed = snap.userEntries.filter((entry) => entry.startsWith(CONFIRMED_PREFIX)).length;
  return [
    {
      label: 'Redis stock equals totalStock minus reserved',
      ok: snap.redisStock === scenario.totalStock - reserved,
      detail: `got ${snap.redisStock}, want ${scenario.totalStock - reserved}`,
    },
    {
      label: 'Redis users hash holds only CONFIRMED reservations',
      ok: snap.userEntries.length === reserved && confirmed === reserved,
      detail: `entries ${snap.userEntries.length}, confirmed ${confirmed}, want ${reserved}`,
    },
    {
      label: 'conservation (Redis stock + PG orders equals totalStock)',
      ok: snap.redisStock + snap.orderIds.length === scenario.totalStock,
      detail: `${snap.redisStock} + ${snap.orderIds.length}`,
    },
  ];
}

function ownerChecks({ scenario, snap }) {
  if (!scenario.normalizedUserId) return [];
  const wrong = snap.orderUserIds.filter((id) => id !== scenario.normalizedUserId);
  return [
    {
      label: 'every PG order belongs to the normalized user',
      ok: wrong.length === 0,
      detail: `${wrong.length} others`,
    },
  ];
}

export function storeChecks(params) {
  const drained = {
    label: `every 202 became CONFIRMED within ${params.scenario.confirmHorizonMs / 1000}s`,
    ok: params.stillPending === 0,
    detail: `${params.stillPending} pending`,
  };
  const [pgOrders, pgStock, pgTotal] = postgresChecks(params);
  const [redisStock, redisUsers, conservation] = redisChecks(params);
  return [
    drained,
    pgOrders,
    pgStock,
    pgTotal,
    redisStock,
    redisUsers,
    conservation,
    ...ownerChecks(params),
  ];
}
