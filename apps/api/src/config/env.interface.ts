export type NodeEnv = 'development' | 'production' | 'test';

export interface AppEnv {
  NODE_ENV: NodeEnv;
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
  RATE_LIMIT_ENABLED: boolean;
}
