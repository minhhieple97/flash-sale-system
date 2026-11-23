export type NodeEnv = 'development' | 'production' | 'test';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppEnv {
  NODE_ENV: NodeEnv;
  LOG_LEVEL: LogLevel;
  PORT: number;
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  DATABASE_POOL_MAX?: number;
  REDIS_HOST: string;
  REDIS_PORT: number;
  ENABLE_ADMIN_ENDPOINTS: boolean;
  ADMIN_API_KEY?: string;
  TRUST_PROXY: boolean;
  RATE_LIMIT_ENABLED: boolean;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
  SALE_STARTS_AT?: string;
  SALE_ENDS_AT?: string;
  SALE_TOTAL_STOCK?: number;
}
