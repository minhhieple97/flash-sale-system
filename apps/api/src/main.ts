import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, createFastifyAdapter } from './app.setup';
import { HTTP_LISTEN_HOST } from './common/constants/common.constants';
import type { AppEnv } from './config/env.interface';
import { parseTrustProxy } from './config/env.schema';
import { loadDotEnvFiles } from './config/load-dotenv.util';

async function bootstrap(): Promise<void> {
  loadDotEnvFiles();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(parseTrustProxy(process.env.TRUST_PROXY)),
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
