import { Injectable, Logger } from '@nestjs/common';
import { HttpLatencyHistogram } from '../collectors/http-latency-histogram';
import {
  DB_POOL_CONNECTIONS_HELP,
  DB_POOL_CONNECTIONS_METRIC,
  DB_POOL_STATES,
  ORDER_PERSISTENCE_HELP,
  ORDER_PERSISTENCE_METRIC,
  ORDER_QUEUE_JOBS_HELP,
  ORDER_QUEUE_JOBS_METRIC,
  PURCHASE_ATTEMPTS_HELP,
  PURCHASE_ATTEMPTS_METRIC,
  QUEUE_JOB_STATES,
} from '../constants/metrics.constants';
import type {
  DbPoolCountsCollector,
  HttpDurationObservation,
  QueueJobCountsCollector,
} from '../interfaces/metrics.interface';
import { escapeLabelValue, renderStateGauge } from '../utils/prometheus.util';

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function renderCounter(name: string, help: string, counts: ReadonlyMap<string, number>): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const [outcome, value] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${name}{outcome="${escapeLabelValue(outcome)}"} ${value}`);
  }
  return lines;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly purchaseAttempts = new Map<string, number>();
  private readonly orderPersistence = new Map<string, number>();
  private readonly httpLatency = new HttpLatencyHistogram();
  private queueCollector: QueueJobCountsCollector | null = null;
  private dbPoolCollector: DbPoolCountsCollector | null = null;

  recordPurchaseAttempt(outcome: string): void {
    increment(this.purchaseAttempts, outcome);
  }

  recordOrderPersistence(outcome: string): void {
    increment(this.orderPersistence, outcome);
  }

  recordHttpRequestDuration(observation: HttpDurationObservation): void {
    this.httpLatency.observe(observation);
  }

  registerQueueCollector(collector: QueueJobCountsCollector): void {
    this.queueCollector = collector;
  }

  registerDbPoolCollector(collector: DbPoolCountsCollector): void {
    this.dbPoolCollector = collector;
  }

  async render(): Promise<string> {
    const sections = [
      ...renderCounter(PURCHASE_ATTEMPTS_METRIC, PURCHASE_ATTEMPTS_HELP, this.purchaseAttempts),
      ...renderCounter(ORDER_PERSISTENCE_METRIC, ORDER_PERSISTENCE_HELP, this.orderPersistence),
      ...this.httpLatency.render(),
      ...(await this.renderQueueGauge()),
      ...(await this.renderDbPoolGauge()),
    ];
    return `${sections.join('\n')}\n`;
  }

  private async renderQueueGauge(): Promise<string[]> {
    if (this.queueCollector === null) return [];
    try {
      const counts = await this.queueCollector();
      return renderStateGauge({
        name: ORDER_QUEUE_JOBS_METRIC,
        help: ORDER_QUEUE_JOBS_HELP,
        states: QUEUE_JOB_STATES,
        counts,
      });
    } catch (error) {
      this.logger.warn(`Failed to collect queue metrics: ${String(error)}`);
      return [];
    }
  }

  private async renderDbPoolGauge(): Promise<string[]> {
    if (this.dbPoolCollector === null) return [];
    try {
      const counts = await this.dbPoolCollector();
      if (counts === null) {
        this.logger.warn('PostgreSQL pool metrics unavailable; skipping gauge');
        return [];
      }
      return renderStateGauge({
        name: DB_POOL_CONNECTIONS_METRIC,
        help: DB_POOL_CONNECTIONS_HELP,
        states: DB_POOL_STATES,
        counts,
      });
    } catch (error) {
      this.logger.warn(`Failed to collect database pool metrics: ${String(error)}`);
      return [];
    }
  }
}
