import { Logger } from '@nestjs/common';
import { MetricsService } from '../../src/modules/metrics/services/metrics.service';

describe('MetricsService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders purchase attempts and order persistence counters in Prometheus text format', async () => {
    const service = new MetricsService();
    service.recordPurchaseAttempt('RESERVED');
    service.recordPurchaseAttempt('RESERVED');
    service.recordPurchaseAttempt('SOLD_OUT');
    service.recordOrderPersistence('INSERTED');
    service.recordOrderPersistence('RELEASED');

    const output = await service.render();

    expect(output).toContain('# TYPE flash_sale_purchase_attempts_total counter');
    expect(output).toContain('flash_sale_purchase_attempts_total{outcome="RESERVED"} 2');
    expect(output).toContain('flash_sale_purchase_attempts_total{outcome="SOLD_OUT"} 1');
    expect(output).toContain('# TYPE flash_sale_order_persistence_total counter');
    expect(output).toContain('flash_sale_order_persistence_total{outcome="INSERTED"} 1');
    expect(output).toContain('flash_sale_order_persistence_total{outcome="RELEASED"} 1');
  });

  it('renders queue job counts from a registered collector', async () => {
    const service = new MetricsService();
    service.registerQueueCollector(async () => ({
      waiting: 4,
      active: 2,
      delayed: 1,
      failed: 3,
    }));

    const output = await service.render();

    expect(output).toContain('# TYPE flash_sale_order_queue_jobs gauge');
    expect(output).toContain('flash_sale_order_queue_jobs{state="waiting"} 4');
    expect(output).toContain('flash_sale_order_queue_jobs{state="active"} 2');
    expect(output).toContain('flash_sale_order_queue_jobs{state="delayed"} 1');
    expect(output).toContain('flash_sale_order_queue_jobs{state="failed"} 3');
  });

  it('swallows queue collector errors gracefully so /metrics still renders counters', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new MetricsService();
    service.recordPurchaseAttempt('TEMPORARY_FAILURE');
    service.registerQueueCollector(async () => {
      throw new Error('redis unreachable');
    });

    const output = await service.render();

    expect(output).toContain('flash_sale_purchase_attempts_total{outcome="TEMPORARY_FAILURE"} 1');
    expect(output).not.toContain('flash_sale_order_queue_jobs{state=');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
