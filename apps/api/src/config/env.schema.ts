import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  MAX_SALE_TOTAL_STOCK,
} from '../common/constants/common.constants';
import type { AppEnv, AppRole, NodeEnv } from './env.interface';

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];
const APP_ROLES: readonly AppRole[] = ['all', 'api', 'worker'];
const MIN_PORT = 1;
const MAX_PORT = 65535;
const MIN_SALE_STOCK = 1;
const MIN_RATE_LIMIT_WINDOW_MS = 1_000;
const MAX_RATE_LIMIT_WINDOW_MS = 3_600_000;
const MIN_RATE_LIMIT_MAX = 1;
const MAX_RATE_LIMIT_MAX = 100_000;
const RFC_3339_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const RFC_3339_MESSAGE =
  '$property must be an RFC 3339 timestamp with Z or an explicit offset, e.g. 2030-01-01T09:00:00Z';
const SALE_WINDOW_VARIABLES = ['SALE_STARTS_AT', 'SALE_ENDS_AT'] as const;

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function toInteger({ value }: { value: unknown }): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return value;
}

function emptyToUndefined({ value }: { value: unknown }): unknown {
  return value === '' ? undefined : value;
}

const toOptionalInteger = ({ value }: { value: unknown }): unknown =>
  toInteger({ value: emptyToUndefined({ value }) });

class EnvironmentVariables implements AppEnv {
  @IsIn(NODE_ENVS) NODE_ENV: NodeEnv = 'development';
  @IsIn(APP_ROLES) APP_ROLE: AppRole = 'all';
  @IsString() @IsNotEmpty() LOG_LEVEL = 'info';

  @Transform(toInteger) @IsInt() @Min(MIN_PORT) @Max(MAX_PORT) PORT = DEFAULT_HTTP_PORT;

  @IsString() @IsNotEmpty() POSTGRES_HOST!: string;
  @Transform(toInteger) @IsInt() @Min(MIN_PORT) @Max(MAX_PORT) POSTGRES_PORT!: number;
  @IsString() @IsNotEmpty() POSTGRES_USER!: string;
  @IsString() @IsNotEmpty() POSTGRES_PASSWORD!: string;
  @IsString() @IsNotEmpty() POSTGRES_DB!: string;

  @IsString() @IsNotEmpty() REDIS_HOST!: string;
  @Transform(toInteger) @IsInt() @Min(MIN_PORT) @Max(MAX_PORT) REDIS_PORT!: number;

  @Transform(toBoolean) @IsBoolean() ENABLE_ADMIN_ENDPOINTS = false;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ADMIN_API_KEY?: string;

  @Transform(toBoolean) @IsBoolean() TRUST_PROXY = false;

  @Transform(toBoolean) @IsBoolean() RATE_LIMIT_ENABLED = false;

  @Transform(toInteger)
  @IsInt()
  @Min(MIN_RATE_LIMIT_WINDOW_MS)
  @Max(MAX_RATE_LIMIT_WINDOW_MS)
  RATE_LIMIT_WINDOW_MS = DEFAULT_RATE_LIMIT_WINDOW_MS;

  @Transform(toInteger)
  @IsInt()
  @Min(MIN_RATE_LIMIT_MAX)
  @Max(MAX_RATE_LIMIT_MAX)
  RATE_LIMIT_MAX = DEFAULT_RATE_LIMIT_MAX;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(RFC_3339_TIMESTAMP, { message: RFC_3339_MESSAGE })
  @IsISO8601({ strict: true }, { message: RFC_3339_MESSAGE })
  SALE_STARTS_AT?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(RFC_3339_TIMESTAMP, { message: RFC_3339_MESSAGE })
  @IsISO8601({ strict: true }, { message: RFC_3339_MESSAGE })
  SALE_ENDS_AT?: string;

  @Transform(toOptionalInteger)
  @IsOptional()
  @IsInt()
  @Min(MIN_SALE_STOCK)
  @Max(MAX_SALE_TOTAL_STOCK)
  SALE_TOTAL_STOCK?: number;
}

function invalid(property: string, detail: string): Error {
  return new Error(`Invalid environment variables (${property}): ${detail}`);
}

function throwIfWindowIncomplete(env: AppEnv): void {
  const [startsAt, endsAt] = SALE_WINDOW_VARIABLES;
  const isSet = (name: (typeof SALE_WINDOW_VARIABLES)[number]): boolean => env[name] !== undefined;
  if (isSet(startsAt) === isSet(endsAt)) return;
  const [set, missing] = isSet(startsAt) ? [startsAt, endsAt] : [endsAt, startsAt];
  throw invalid(missing, `${missing} must be set together with ${set}`);
}

function validateSaleWindow(env: AppEnv): AppEnv {
  throwIfWindowIncomplete(env);
  if (env.SALE_STARTS_AT === undefined || env.SALE_ENDS_AT === undefined) return env;
  if (Date.parse(env.SALE_ENDS_AT) > Date.parse(env.SALE_STARTS_AT)) return env;
  throw invalid('SALE_ENDS_AT', 'SALE_ENDS_AT must be after SALE_STARTS_AT');
}

function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

export function parseAppRole(raw?: string): AppRole {
  if (raw === undefined || raw === '') return 'all';
  if (isAppRole(raw)) return raw;
  throw invalid('APP_ROLE', `APP_ROLE must be one of ${APP_ROLES.join(', ')}`);
}

export function parseTrustProxy(raw?: string): boolean {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw invalid('TRUST_PROXY', 'TRUST_PROXY must be true or false');
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const env = plainToInstance(EnvironmentVariables, raw);
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length === 0) return validateSaleWindow(env);
  const names = errors.map((error) => error.property).join(', ');
  const details = new Set(errors.flatMap((error) => Object.values(error.constraints ?? {})));
  throw invalid(names, [...details].join('; '));
}
