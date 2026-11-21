function nearestRank(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function latencySummary(latenciesMs) {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  return {
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

export function printReport({ scenario, result, latency, checks }) {
  const seconds = result.wallMs / 1000;
  const fmt = (n) => n.toFixed(1);
  console.log(`\n== ${scenario.name} ==`);
  console.log(
    `requests=${scenario.requests} concurrency=${scenario.concurrency} wall=${fmt(seconds)}s`,
  );
  const warmup =
    result.warmupMs === undefined
      ? 'connections opened cold, inside the timed burst'
      : `${scenario.concurrency} keep-alive sockets warmed in ${fmt(result.warmupMs)}ms (not timed)`;
  console.log(`client node ${process.version}, ${warmup}`);
  console.log(`throughput=${fmt(scenario.requests / seconds)} req/s`);
  console.log(
    `latency ms p50=${fmt(latency.p50)} p95=${fmt(latency.p95)} p99=${fmt(latency.p99)} max=${fmt(latency.max)}`,
  );
  console.log(
    `client event-loop delay p99=${fmt(result.clientLoopDelayP99Ms)}ms (included in the latency above; the k6 scripts own the p95 budget)`,
  );
  console.log(`counts ${JSON.stringify(result.counts)}`);
  for (const { label, ok, detail } of checks) {
    console.log(ok ? `PASS ${label}` : `FAIL ${label} ${detail}`);
  }
}
