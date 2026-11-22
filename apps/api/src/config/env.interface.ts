export type NodeEnv = 'development' | 'production' | 'test';
export type AppRole = 'all' | 'api' | 'worker';

export interface AppEnv {
  NODE_ENV: NodeEnv;
  APP_ROLE: AppRole;
  LOG_LEVEL: string;
  PORT: number;
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
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
