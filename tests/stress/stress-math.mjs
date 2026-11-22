// Pure helpers shared by the Node runner and the k6 scripts. Keep it free of Node built-ins and k6 imports.
export const MID_RUN_TRIM = 0.1;
export const BARRIER_MIN_RATIO = 0.95;

export function rateOver(count, minMs, maxMs) {
  if (maxMs <= minMs) return Number.NaN;
  return ((count - 1) / (maxMs - minMs)) * 1000;
}

export function midRunThroughput(completionsMs) {
  const sorted = [...completionsMs].sort((a, b) => a - b);
  const from = Math.floor(sorted.length * MID_RUN_TRIM);
  const mid = sorted.slice(from, sorted.length - from);
  return rateOver(mid.length, mid[0], mid.at(-1));
}

export function isMidRun(index, total) {
  return (
    index >= Math.floor(total * MID_RUN_TRIM) && index < total - Math.floor(total * MID_RUN_TRIM)
  );
}

export function barrierVerdict(reached, total) {
  const minimum = Math.ceil(total * BARRIER_MIN_RATIO);
  return { ok: reached >= minimum, reached, total, minimum };
}

export function mergeThresholds(base, extra) {
  const merged = { ...base };
  for (const [metric, rules] of Object.entries(extra)) {
    merged[metric] = [...(merged[metric] ?? []), ...rules];
  }
  return merged;
}
