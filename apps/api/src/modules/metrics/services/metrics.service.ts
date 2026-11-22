import { Injectable, Logger } from '@nestjs/common';
import {
  ORDER_PERSISTENCE_HELP,
  ORDER_PERSISTENCE_METRIC,
  ORDER_QUEUE_JOBS_HELP,
  ORDER_QUEUE_JOBS_METRIC,
  PURCHASE_ATTEMPTS_HELP,
  PURCHASE_ATTEMPTS_METRIC,
  QUEUE_JOB_STATES,
} from '../constants/metrics.constants';
import type { QueueJobCountsCollector } from '../interfaces/metrics.interface';

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

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
  private queueCollector: QueueJobCountsCollector | null = null;

  recordPurchaseAttempt(outcome: string): void {
    increment(this.purchaseAttempts, outcome);
  }

  recordOrderPersistence(outcome: string): void {
    increment(this.orderPersistence, outcome);
  }

  registerQueueCollector(collector: QueueJobCountsCollector): void {
    this.queueCollector = collector;
  }

  async render(): Promise<string> {
    const sections = [
      ...renderCounter(PURCHASE_ATTEMPTS_METRIC, PURCHASE_ATTEMPTS_HELP, this.purchaseAttempts),
      ...renderCounter(ORDER_PERSISTENCE_METRIC, ORDER_PERSISTENCE_HELP, this.orderPersistence),
      ...(await this.renderQueueGauge()),
    ];
    return `${sections.join('\n')}\n`;
  }

  private async renderQueueGauge(): Promise<string[]> {
    if (this.queueCollector === null) return [];
    try {
      const counts = await this.queueCollector();
      const lines = [
        `# HELP ${ORDER_QUEUE_JOBS_METRIC} ${ORDER_QUEUE_JOBS_HELP}`,
        `# TYPE ${ORDER_QUEUE_JOBS_METRIC} gauge`,
      ];
      for (const state of QUEUE_JOB_STATES) {
        lines.push(`${ORDER_QUEUE_JOBS_METRIC}{state="${state}"} ${counts[state] ?? 0}`);
      }
      return lines;
    } catch (error) {
      this.logger.warn(`Failed to collect queue metrics: ${String(error)}`);
      return [];
    }
  }
}
