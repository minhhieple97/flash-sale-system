import {
  HTTP_DURATION_BUCKETS,
  HTTP_REQUEST_DURATION_HELP,
  HTTP_REQUEST_DURATION_METRIC,
  UNMATCHED_HTTP_ROUTE,
} from '../constants/metrics.constants';
import type { HttpDurationObservation } from '../interfaces/metrics.interface';
import { escapeLabelValue } from '../utils/prometheus.util';

interface HistogramSeries {
  readonly labels: string;
  readonly bucketCounts: number[];
  sum: number;
  count: number;
}

function toStatusClass(statusCode: number): string {
  const century = Math.floor(statusCode / 100);
  if (century >= 1 && century <= 5) return `${century}xx`;
  return 'unknown';
}

function buildLabelKey(observation: HttpDurationObservation): string {
  const method = observation.method.length > 0 ? observation.method.toUpperCase() : 'UNKNOWN';
  const route =
    observation.route && observation.route.length > 0 ? observation.route : UNMATCHED_HTTP_ROUTE;
  const statusClass = toStatusClass(observation.statusCode);
  return `method="${escapeLabelValue(method)}",route="${escapeLabelValue(route)}",status_class="${statusClass}"`;
}

function renderSeries(name: string, buckets: readonly number[], series: HistogramSeries): string[] {
  const lines = buckets.map(
    (bound, index) =>
      `${name}_bucket{${series.labels},le="${bound}"} ${series.bucketCounts[index]}`,
  );
  lines.push(`${name}_bucket{${series.labels},le="+Inf"} ${series.count}`);
  lines.push(`${name}_sum{${series.labels}} ${Number(series.sum.toFixed(9))}`);
  lines.push(`${name}_count{${series.labels}} ${series.count}`);
  return lines;
}

export class HttpLatencyHistogram {
  private readonly series = new Map<string, HistogramSeries>();

  constructor(private readonly buckets: readonly number[] = HTTP_DURATION_BUCKETS) {}

  observe(observation: HttpDurationObservation): void {
    if (!Number.isFinite(observation.durationSeconds)) return;
    const duration = Math.max(0, observation.durationSeconds);
    const entry = this.getOrCreateSeries(buildLabelKey(observation));
    entry.count += 1;
    entry.sum += duration;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (duration <= this.buckets[i]) {
        entry.bucketCounts[i] += 1;
      }
    }
  }

  render(): string[] {
    const lines = [
      `# HELP ${HTTP_REQUEST_DURATION_METRIC} ${HTTP_REQUEST_DURATION_HELP}`,
      `# TYPE ${HTTP_REQUEST_DURATION_METRIC} histogram`,
    ];
    const sorted = [...this.series.values()].sort((a, b) => a.labels.localeCompare(b.labels));
    for (const entry of sorted) {
      lines.push(...renderSeries(HTTP_REQUEST_DURATION_METRIC, this.buckets, entry));
    }
    return lines;
  }

  private getOrCreateSeries(labels: string): HistogramSeries {
    const existing = this.series.get(labels);
    if (existing !== undefined) return existing;
    const created: HistogramSeries = {
      labels,
      bucketCounts: new Array<number>(this.buckets.length).fill(0),
      sum: 0,
      count: 0,
    };
    this.series.set(labels, created);
    return created;
  }
}
