import { HttpLatencyHistogram } from '../../src/modules/metrics/collectors/http-latency-histogram';
import {
  HTTP_DURATION_BUCKETS,
  HTTP_REQUEST_DURATION_HELP,
  HTTP_REQUEST_DURATION_METRIC,
} from '../../src/modules/metrics/constants/metrics.constants';

describe('HttpLatencyHistogram', () => {
  it('renders HELP and TYPE headers even before any observation is recorded', () => {
    const histogram = new HttpLatencyHistogram();

    expect(histogram.render()).toEqual([
      `# HELP ${HTTP_REQUEST_DURATION_METRIC} ${HTTP_REQUEST_DURATION_HELP}`,
      `# TYPE ${HTTP_REQUEST_DURATION_METRIC} histogram`,
    ]);
  });

  it('accumulates cumulative Prometheus buckets, +Inf, sum, and count accurately', () => {
    const histogram = new HttpLatencyHistogram();
    histogram.observe({
      method: 'post',
      route: '/api/v1/checkout/purchase',
      statusCode: 202,
      durationSeconds: 0.005,
    });
    histogram.observe({
      method: 'POST',
      route: '/api/v1/checkout/purchase',
      statusCode: 200,
      durationSeconds: 0.12,
    });
    histogram.observe({
      method: 'POST',
      route: '/api/v1/checkout/purchase',
      statusCode: 204,
      durationSeconds: 7.5,
    });

    const lines = histogram.render();
    const baseLabels = 'method="POST",route="/api/v1/checkout/purchase",status_class="2xx"';

    expect(HTTP_DURATION_BUCKETS).toEqual([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_bucket{${baseLabels},le="0.005"} 1`);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_bucket{${baseLabels},le="0.1"} 1`);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_bucket{${baseLabels},le="0.25"} 2`);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_bucket{${baseLabels},le="5"} 2`);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_bucket{${baseLabels},le="+Inf"} 3`);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_sum{${baseLabels}} 7.625`);
    expect(lines).toContain(`${HTTP_REQUEST_DURATION_METRIC}_count{${baseLabels}} 3`);
  });

  it('bounds route cardinality by collapsing missing or empty routes to UNMATCHED', () => {
    const histogram = new HttpLatencyHistogram();
    histogram.observe({ method: 'GET', route: undefined, statusCode: 404, durationSeconds: 0.01 });
    histogram.observe({ method: 'GET', route: '', statusCode: 404, durationSeconds: 0.02 });
    histogram.observe({
      method: 'GET',
      route: '/api/v1/orders/user/:userId',
      statusCode: 200,
      durationSeconds: 0.03,
    });

    const lines = histogram.render();

    expect(lines).toContain(
      `${HTTP_REQUEST_DURATION_METRIC}_count{method="GET",route="UNMATCHED",status_class="4xx"} 2`,
    );
    expect(lines).toContain(
      `${HTTP_REQUEST_DURATION_METRIC}_count{method="GET",route="/api/v1/orders/user/:userId",status_class="2xx"} 1`,
    );
  });

  it.each([
    [200, '2xx'],
    [304, '3xx'],
    [429, '4xx'],
    [503, '5xx'],
    [999, 'unknown'],
  ])('maps status code %i to bounded status_class %s', (statusCode, expectedClass) => {
    const histogram = new HttpLatencyHistogram();
    histogram.observe({ method: 'GET', route: '/health', statusCode, durationSeconds: 0.004 });

    const lines = histogram.render();

    expect(lines).toContain(
      `${HTTP_REQUEST_DURATION_METRIC}_count{method="GET",route="/health",status_class="${expectedClass}"} 1`,
    );
  });

  it('escapes backslashes, quotes, and newlines in Prometheus label values', () => {
    const histogram = new HttpLatencyHistogram();
    histogram.observe({
      method: 'GET',
      route: '/weird\\"path\ninjection',
      statusCode: 400,
      durationSeconds: 0.01,
    });

    const output = histogram.render().join('\n');

    expect(output).toContain('route="/weird\\\\\\"path\\ninjection"');
  });

  it('clamps negative durations to 0 and ignores non-finite durations', () => {
    const histogram = new HttpLatencyHistogram();
    histogram.observe({ method: 'GET', route: '/health', statusCode: 200, durationSeconds: -0.5 });
    histogram.observe({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationSeconds: Number.NaN,
    });
    histogram.observe({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationSeconds: Number.POSITIVE_INFINITY,
    });

    const lines = histogram.render();

    expect(lines).toContain(
      `${HTTP_REQUEST_DURATION_METRIC}_bucket{method="GET",route="/health",status_class="2xx",le="0.005"} 1`,
    );
    expect(lines).toContain(
      `${HTTP_REQUEST_DURATION_METRIC}_sum{method="GET",route="/health",status_class="2xx"} 0`,
    );
    expect(lines).toContain(
      `${HTTP_REQUEST_DURATION_METRIC}_count{method="GET",route="/health",status_class="2xx"} 1`,
    );
  });
});
