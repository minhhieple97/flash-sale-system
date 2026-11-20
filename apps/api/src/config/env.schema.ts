import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { DEFAULT_HTTP_PORT } from '../common/constants/common.constants';
import type { AppEnv, NodeEnv } from './env.interface';

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];
const MIN_PORT = 1;
const MAX_PORT = 65535;

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function toInteger({ value }: { value: unknown }): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return value;
}

class EnvironmentVariables implements AppEnv {
  @IsIn(NODE_ENVS) NODE_ENV: NodeEnv = 'development';
  @IsString() @IsNotEmpty() LOG_LEVEL = 'info';

  @Transform(toInteger) @IsInt() @Min(MIN_PORT) @Max(MAX_PORT) PORT = DEFAULT_HTTP_PORT;

  @IsString() @IsNotEmpty() POSTGRES_HOST!: string;
  @Transform(toInteger) @IsInt() @Min(MIN_PORT) @Max(MAX_PORT) POSTGRES_PORT!: number;
  @IsString() @IsNotEmpty() POSTGRES_USER!: string;
  @IsString() @IsNotEmpty() POSTGRES_PASSWORD!: string;
  @IsString() @IsNotEmpty() POSTGRES_DB!: string;

  @IsString() @IsNotEmpty() REDIS_HOST!: string;
  @Transform(toInteger) @IsInt() @Min(MIN_PORT) @Max(MAX_PORT) REDIS_PORT!: number;

  @Transform(toBoolean) @IsBoolean() ENABLE_ADMIN_ENDPOINTS = true;
  @Transform(toBoolean) @IsBoolean() RATE_LIMIT_ENABLED = false;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const env = plainToInstance(EnvironmentVariables, raw);
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length === 0) return env;
  const names = errors.map((error) => error.property).join(', ');
  const details = errors.flatMap((error) => Object.values(error.constraints ?? {}));
  throw new Error(`Invalid environment variables (${names}): ${details.join('; ')}`);
}
