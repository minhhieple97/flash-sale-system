import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { HTTP_BODY_LIMIT_BYTES, HTTP_LISTEN_HOST } from './common/constants/common.constants';
import type { AppEnv } from './config/env.interface';
import { parseAppRole, parseTrustProxy } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const role = parseAppRole(process.env.APP_ROLE);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRole(role),
    new FastifyAdapter({
      bodyLimit: HTTP_BODY_LIMIT_BYTES,
      trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const port: number = config.get('PORT', { infer: true });
  await app.listen(port, HTTP_LISTEN_HOST);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`Bootstrap failed: ${String(error)}\n`);
  process.exit(1);
});
