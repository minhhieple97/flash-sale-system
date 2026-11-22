export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
export const PURCHASE_ATTEMPTS_METRIC = 'flash_sale_purchase_attempts_total';
export const PURCHASE_ATTEMPTS_HELP = 'Total flash sale purchase attempts by outcome.';
export const ORDER_PERSISTENCE_METRIC = 'flash_sale_order_persistence_total';
export const ORDER_PERSISTENCE_HELP = 'Total order persistence and compensation outcomes.';
export const ORDER_QUEUE_JOBS_METRIC = 'flash_sale_order_queue_jobs';
export const ORDER_QUEUE_JOBS_HELP = 'Current BullMQ order persistence queue job counts by state.';
export const QUEUE_JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;
