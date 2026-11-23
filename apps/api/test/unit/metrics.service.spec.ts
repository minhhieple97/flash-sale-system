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

  it('renders HTTP request latency histogram buckets, sum, and count', async () => {
    const service = new MetricsService();
    service.recordHttpRequestDuration({
      method: 'POST',
      route: '/api/v1/checkout/purchase',
      statusCode: 202,
      durationSeconds: 0.04,
    });

    const output = await service.render();

    expect(output).toContain('# TYPE flash_sale_http_request_duration_seconds histogram');
    expect(output).toContain(
      'flash_sale_http_request_duration_seconds_bucket{method="POST",route="/api/v1/checkout/purchase",status_class="2xx",le="0.05"} 1',
    );
    expect(output).toContain(
      'flash_sale_http_request_duration_seconds_sum{method="POST",route="/api/v1/checkout/purchase",status_class="2xx"} 0.04',
    );
    expect(output).toContain(
      'flash_sale_http_request_duration_seconds_count{method="POST",route="/api/v1/checkout/purchase",status_class="2xx"} 1',
    );
  });

  it('renders PostgreSQL connection pool counts from a registered collector', async () => {
    const service = new MetricsService();
    service.registerDbPoolCollector(() => ({ total: 10, idle: 6, waiting: 1 }));

    const output = await service.render();

    expect(output).toContain('# TYPE flash_sale_db_pool_connections gauge');
    expect(output).toContain('flash_sale_db_pool_connections{state="total"} 10');
    expect(output).toContain('flash_sale_db_pool_connections{state="idle"} 6');
    expect(output).toContain('flash_sale_db_pool_connections{state="waiting"} 1');
  });

  it('swallows DB pool collector errors and unavailable pool reads gracefully', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new MetricsService();
    service.recordPurchaseAttempt('RESERVED');
    service.registerDbPoolCollector(async () => {
      throw new Error('pool closed');
    });

    const afterError = await service.render();

    expect(afterError).toContain('flash_sale_purchase_attempts_total{outcome="RESERVED"} 1');
    expect(afterError).not.toContain('flash_sale_db_pool_connections');
    expect(warn).toHaveBeenCalledTimes(1);

    service.registerDbPoolCollector(() => null);
    const afterNull = await service.render();

    expect(afterNull).not.toContain('flash_sale_db_pool_connections');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
