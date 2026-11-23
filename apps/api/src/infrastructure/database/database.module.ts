import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { AppEnv } from '../../config/env.interface';
import {
  API_DATABASE_POOL_MAX,
  DATABASE_CONNECTION_TIMEOUT_MS,
  DATABASE_POOL_MAX,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from './database.constants';
import { SchemaConstraintsInitializer } from './schema-constraints.initializer';

export function buildPostgresOptions(config: ConfigService<AppEnv, true>): TypeOrmModuleOptions {
  const host: string = config.get('POSTGRES_HOST', { infer: true });
  const port: number = config.get('POSTGRES_PORT', { infer: true });
  const username: string = config.get('POSTGRES_USER', { infer: true });
  const password: string = config.get('POSTGRES_PASSWORD', { infer: true });
  const database: string = config.get('POSTGRES_DB', { infer: true });
  const poolMax =
    config.get('DATABASE_POOL_MAX', { infer: true }) ??
    (config.get('APP_ROLE', { infer: true }) === 'api' ? API_DATABASE_POOL_MAX : DATABASE_POOL_MAX);
  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    autoLoadEntities: true,
    synchronize: false,
    extra: {
      max: poolMax,
      connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    },
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: buildPostgresOptions }),
  ],
  providers: [SchemaConstraintsInitializer],
})
export class DatabaseModule {}
