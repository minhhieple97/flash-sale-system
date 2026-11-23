export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
export const PURCHASE_ATTEMPTS_METRIC = 'flash_sale_purchase_attempts_total';
export const PURCHASE_ATTEMPTS_HELP = 'Total flash sale purchase attempts by outcome.';
export const ORDER_PERSISTENCE_METRIC = 'flash_sale_order_persistence_total';
export const ORDER_PERSISTENCE_HELP = 'Total order persistence and compensation outcomes.';
export const ORDER_QUEUE_JOBS_METRIC = 'flash_sale_order_queue_jobs';
export const ORDER_QUEUE_JOBS_HELP = 'Current BullMQ order persistence queue job counts by state.';
export const QUEUE_JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;
export const HTTP_REQUEST_DURATION_METRIC = 'flash_sale_http_request_duration_seconds';
export const HTTP_REQUEST_DURATION_HELP =
  'HTTP request duration in seconds by method, route, and status class.';
export const HTTP_DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];
export const UNMATCHED_HTTP_ROUTE = 'UNMATCHED';
export const DB_POOL_CONNECTIONS_METRIC = 'flash_sale_db_pool_connections';
export const DB_POOL_CONNECTIONS_HELP = 'Current PostgreSQL connection pool counts by state.';
export const DB_POOL_STATES = ['total', 'idle', 'waiting'] as const;
